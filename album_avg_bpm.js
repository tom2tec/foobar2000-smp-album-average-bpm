'use strict';

/*
====================================================
Album Average BPM Panel - FULL PRO v11
- Live status display above progress bars
- Full report diagnostics displayed in panel
- Buttons and checkboxes functional
- Layout and spacing adjusted
====================================================
*/

function RGB(r,g,b){ return (0xff000000 | (r<<16) | (g<<8) | b); }

////////////////////////////////////////////////////
// TitleFormats
////////////////////////////////////////////////////
const tf_album = fb.TitleFormat("%album%");
const tf_albumArtist = fb.TitleFormat("%album artist%");
const tf_artist = fb.TitleFormat("%artist%");
const tf_bpm = fb.TitleFormat("%bpm%");
const tf_existing = fb.TitleFormat("%album_avg_bpm%");

////////////////////////////////////////////////////
// UI Colours + Font
////////////////////////////////////////////////////
function getUIColours(){
    try{return { bg: window.GetColourDUI(1), text: window.GetColourDUI(0), accent: window.GetColourDUI(2) };}
    catch(e){ return { bg: RGB(30,30,30), text: RGB(255,255,255), accent: RGB(0,200,0) };}
}
function getUIFont(){ try{ return window.GetFontDUI(0); } catch(e){ return gdi.Font("Segoe UI",13,0); } }

////////////////////////////////////////////////////
// Library cache
////////////////////////////////////////////////////
let libHandles = null;
function loadLibraryOnce(){ if(!libHandles) libHandles = fb.GetLibraryItems(); }

////////////////////////////////////////////////////
// State
////////////////////////////////////////////////////
let runningUpdate=false, reporting=false, cancelled=false;
let updateIndex=0, updateTimer=0;
let reportIndex=0, reportTimer=0;
let currentAlbum="Idle", currentAvg=0;
let updates=0, skippedFiles=[];
let finishedUpdateMessage="";
let currentStatus = "Idle";

let totalFiles=0, totalAlbums={};
let missingBPM=0, zeroBPM=0, missingAlbumAvg=0;
let minBPM=999999, maxBPM=0;
let albumConsistency={}, inconsistentAlbums=0;

let forceRecalc=false, useMedian=false;
let reportText="Press Scan Library.";

////////////////////////////////////////////////////
// Layout
////////////////////////////////////////////////////
const LEFT_WIDTH = 280;
const BUTTON_WIDTH = 180;
const BUTTON_HEIGHT = 32;
const buttonScan={x:20,y:20,w:BUTTON_WIDTH,h:BUTTON_HEIGHT};
const buttonUpdate={x:20,y:60,w:BUTTON_WIDTH,h:BUTTON_HEIGHT};
const buttonCopy={x:20,y:100,w:BUTTON_WIDTH,h:BUTTON_HEIGHT};
const buttonCancel={x:20,y:140,w:BUTTON_WIDTH,h:BUTTON_HEIGHT};
const checkboxForce={x:20,y:180,size:18};
const checkboxMedian={x:20,y:210,size:18};

////////////////////////////////////////////////////
// Album BPM Update Logic
////////////////////////////////////////////////////
let albumsMap=[];
function buildAlbums(){
    loadLibraryOnce();
    albumsMap=[];
    let map={};

    for(let i=0;i<libHandles.Count;i++){
        let h=libHandles[i];
        let album=tf_album.EvalWithMetadb(h) || "(No Album)";
        let albumArtist=tf_albumArtist.EvalWithMetadb(h);
        let artist=tf_artist.EvalWithMetadb(h) || "(No Artist)";
        let bpm=parseFloat(tf_bpm.EvalWithMetadb(h));
        if(isNaN(bpm)) bpm=0;
        if(bpm>400) continue; 

        let groupingArtist = albumArtist ? albumArtist : artist;
        let key = groupingArtist+"|||"+album;

        if(!map[key]){
            map[key]={ handles:new FbMetadbHandleList(), sum:0, count:0, hasExisting:true, existingValues:{} };
        }

        map[key].handles.Add(h);
        map[key].sum += bpm;
        map[key].count++;

        let albumAvg = tf_existing.EvalWithMetadb(h);
        if(albumAvg) map[key].existingValues[albumAvg]=true;
        if(!albumAvg) map[key].hasExisting=false;
    }

    albumsMap = Object.values(map);
}

function stopUpdateTimer(){ if(updateTimer){ window.ClearInterval(updateTimer); updateTimer=0; } }
function stopReportTimer(){ if(reportTimer){ window.ClearInterval(reportTimer); reportTimer=0; } }

function cancelAll(){
    cancelled=true;
    runningUpdate=false;
    reporting=false;
    stopUpdateTimer();
    stopReportTimer();
    finishedUpdateMessage="Cancelled by user.";
    currentStatus="Cancelled.";
    window.Repaint();
}

function processUpdateNext(){
    if(!runningUpdate || cancelled) return;

    if(updateIndex>=albumsMap.length){
        runningUpdate=false;
        stopUpdateTimer();
        currentAlbum="Update Finished"; currentAvg=0;
        finishedUpdateMessage = `Album BPM Update Finished. Updated Albums: ${updates}`;
        currentStatus=finishedUpdateMessage;
        updateReportDisplay();
        window.Repaint();
        return;
    }

    let data = albumsMap[updateIndex++];
    currentAlbum=tf_album.EvalWithMetadb(data.handles[0]);
    currentAvg=0;

    let inconsistent = Object.keys(data.existingValues).length > 1;
    if(!forceRecalc && !inconsistent){
        currentStatus = `Album ${updateIndex} / ${albumsMap.length} — ${currentAlbum} (Skipped)`;
        updateReportDisplay();
        window.Repaint();
        return;
    }

    if(useMedian){
        let arr=[];
        for(let i=0;i<data.handles.Count;i++){
            let val=parseFloat(tf_bpm.EvalWithMetadb(data.handles[i]));
            if(!isNaN(val) && val<=400) arr.push(val);
        }
        arr.sort((a,b)=>a-b);
        let mid=Math.floor(arr.length/2);
        currentAvg = arr.length%2===0 ? (arr[mid-1]+arr[mid])/2 : arr[mid];
    }else{
        currentAvg = data.sum / data.count;
    }
    currentAvg=parseFloat(currentAvg.toFixed(2));

    let json=[];
    for(let i=0;i<data.handles.Count;i++){
        try{ json.push({"ALBUM_AVG_BPM":currentAvg}); }
        catch(e){ skippedFiles.push(data.handles[i].Path); }
    }

    try{ data.handles.UpdateFileInfoFromJSON(JSON.stringify(json)); updates++; }
    catch(e){ for(let i=0;i<data.handles.Count;i++) skippedFiles.push(data.handles[i].Path); }

    currentStatus = `Album ${updateIndex} / ${albumsMap.length} — ${currentAlbum} (Avg: ${currentAvg})`;
    updateReportDisplay();
    window.Repaint();
}

function startUpdate(){
    if(runningUpdate) return;
    cancelled=false;
    loadLibraryOnce();
    buildAlbums();
    updates=0;
    updateIndex=0;
    runningUpdate=true;
    finishedUpdateMessage="";
    currentAlbum="Initializing...";
    currentAvg=0;
    currentStatus="Initializing album BPM update...";
    updateReportDisplay();
    window.Repaint();
    updateTimer = window.SetInterval(processUpdateNext,50);
}

////////////////////////////////////////////////////
// Report Logic
////////////////////////////////////////////////////
function updateReportDisplay(){
    reportText =
`Library Diagnostic Report

Files:
- Total files scanned: ${totalFiles} 
- Total albums scanned: ${Object.keys(totalAlbums).length} 

BPM Status:
- Files missing BPM tag: ${missingBPM} 
- Files with BPM = 0: ${zeroBPM} 

Album Avg Status:
- Files missing album_avg_bpm: ${missingAlbumAvg} 
- Albums with inconsistent album_avg_bpm: ${inconsistentAlbums} 

Update Status:
- Albums processed / total: ${updateIndex} / ${albumsMap.length}
- Current album: ${currentAlbum}
- Current avg BPM: ${currentAvg}

Skipped files: ${skippedFiles.length}

BPM Range:
- Lowest BPM: ${minBPM===999999?"N/A":minBPM}
- Highest BPM: ${maxBPM===0?"N/A":maxBPM}

Message:
${finishedUpdateMessage || currentStatus}`;
}

function processReportNext(){
    if(!reporting || cancelled) return;

    let batch=500;
    for(let c=0;c<batch && reportIndex<libHandles.Count;c++){
        let h = libHandles[reportIndex++];
        let album=tf_album.EvalWithMetadb(h) || "(No Album)";
        let albumArtist=tf_albumArtist.EvalWithMetadb(h);
        let artist=tf_artist.EvalWithMetadb(h) || "(No Artist)";
        let bpmStr=tf_bpm.EvalWithMetadb(h);
        let albumAvg=tf_existing.EvalWithMetadb(h);

        let groupingArtist=albumArtist||artist;
        let key=groupingArtist+"|||"+album;

        totalFiles++;
        totalAlbums[key]=true;

        if(!bpmStr) missingBPM++;
        let bpm=parseFloat(bpmStr);
        if(!isNaN(bpm)){
            if(bpm===0) zeroBPM++;
            if(bpm>0){ if(bpm<minBPM) minBPM=bpm; if(bpm>maxBPM) maxBPM=bpm; }
        }

        if(!albumAvg) missingAlbumAvg++;

        if(!albumConsistency[key]) albumConsistency[key]={};
        if(albumAvg) albumConsistency[key][albumAvg]=true;
    }

    if(reportIndex>=libHandles.Count){
        reporting=false;
        stopReportTimer();

        inconsistentAlbums=0;
        for(let k in albumConsistency){ if(Object.keys(albumConsistency[k]).length>1) inconsistentAlbums++; }
        finishedUpdateMessage="Library scan completed.";
    }

    updateReportDisplay();
    window.Repaint();
}

function startReport(){
    if(reporting) return;
    cancelled=false;
    loadLibraryOnce();
    reportIndex=0;
    totalFiles=0; totalAlbums={};
    missingBPM=0; zeroBPM=0; missingAlbumAvg=0;
    minBPM=999999; maxBPM=0; albumConsistency={};
    skippedFiles=[];
    reporting=true;
    currentAlbum="Initializing...";
    currentAvg=0;
    currentStatus="Initializing library scan...";
    updateReportDisplay();
    window.Repaint();
    reportTimer = window.SetInterval(processReportNext,10);
}

////////////////////////////////////////////////////
// Drawing
////////////////////////////////////////////////////
function drawButton(gr,b,label,ui,font){
    gr.FillSolidRect(b.x,b.y,b.w,b.h,ui.accent);
    gr.DrawString(label,gdi.Font(font.Name,13,1),ui.text,b.x,b.y,b.w,b.h,0x11000000);
}
function drawCheckbox(gr,c,label,state,ui,font){
    gr.DrawRect(c.x,c.y,c.size,c.size,1,ui.text);
    if(state) gr.FillSolidRect(c.x+4,c.y+4,c.size-8,c.size-8,ui.accent);
    gr.DrawString(label,font,ui.text,c.x+28,c.y-2,300,24,0);
}

function on_paint(gr){
    let ui=getUIColours();
    let font=getUIFont();
    let titleFont=gdi.Font(font.Name,16,1);

    gr.FillSolidRect(0,0,window.Width,window.Height,ui.bg);

    // LEFT PANEL
    gr.DrawString("Album Avg BPM Tools",titleFont,ui.text,20,0,LEFT_WIDTH,30,0);
    drawButton(gr,buttonScan,"Scan Library",ui,font);
    drawButton(gr,buttonUpdate,"Run Album BPM Update",ui,font);
    drawButton(gr,buttonCopy,"Copy Report",ui,font);
    drawButton(gr,buttonCancel,"Cancel",ui,font);
    drawCheckbox(gr,checkboxForce,"Force Recalculate",forceRecalc,ui,font);
    drawCheckbox(gr,checkboxMedian,"Use Median Averaging",useMedian,ui,font);

    gr.DrawLine(LEFT_WIDTH,0,LEFT_WIDTH,window.Height,1,ui.text);

    // RIGHT PANEL: Report
    gr.GdiDrawText(reportText,font,ui.text,
        LEFT_WIDTH+20,20,
        window.Width-(LEFT_WIDTH+40),
        window.Height-140,0);

    // Live Status line just above progress bars
    gr.DrawString(currentStatus,font,ui.text,LEFT_WIDTH+20,window.Height-90,window.Width-LEFT_WIDTH-40,20,0);

    // Progress Bars
    const barHeight=18, margin=8;
    if(runningUpdate){
        let prog=Math.floor((updateIndex/albumsMap.length)*(window.Width-LEFT_WIDTH-40));
        gr.FillSolidRect(LEFT_WIDTH+20,window.Height-barHeight*2-margin,prog,barHeight,ui.accent);
        gr.DrawRect(LEFT_WIDTH+20,window.Height-barHeight*2-margin,window.Width-LEFT_WIDTH-40,barHeight,1,ui.text);
    }
    if(reporting){
        let prog=Math.floor((reportIndex/libHandles.Count)*(window.Width-LEFT_WIDTH-40));
        gr.FillSolidRect(LEFT_WIDTH+20,window.Height-barHeight-margin,prog,barHeight,ui.accent);
        gr.DrawRect(LEFT_WIDTH+20,window.Height-barHeight-margin,window.Width-LEFT_WIDTH-40,barHeight,1,ui.text);
    }
}

////////////////////////////////////////////////////
// Mouse
////////////////////////////////////////////////////
function on_mouse_lbtn_up(x,y){
    if(hit(buttonScan,x,y)) startReport();
    if(hit(buttonUpdate,x,y)) startUpdate();
    if(hit(buttonCopy,x,y) && reportText){ utils.SetClipboardText(reportText); fb.ShowPopupMessage("Report copied to clipboard."); }
    if(hit(buttonCancel,x,y)) cancelAll();
    if(hitSquare(checkboxForce,x,y)){ forceRecalc=!forceRecalc; window.Repaint(); }
    if(hitSquare(checkboxMedian,x,y)){ useMedian=!useMedian; window.Repaint(); }
}

function hit(b,x,y){ return x>=b.x && x<=b.x+b.w && y>=b.y && y<=b.y+b.h; }
function hitSquare(c,x,y){ return x>=c.x && x<=c.x+c.size && y>=c.y && y<=c.y+c.size; }
