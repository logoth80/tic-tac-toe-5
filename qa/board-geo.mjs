/* qa/board-geo.mjs - one copy of the instrument that reads the board out of the canvas bitmap.
   It answers two questions that no amount of reading the DOM can answer: how many cells wide the drawn
   board really is, and what the board looks like as pixels (which colours hold, how far the stones'
   ink reaches). Written for the grid in the page's own palette: the felt and the grid lines are only
   ~28 apart in some themes, so the tolerance that separates them is measured, not assumed - the probe
   reports the distance from every candidate colour to the grid colour the page declares, and finds the
   line/dark separation itself. Used by qa/ui-check.mjs and by the one-off measuring scripts. */

/* Evaluates in the page and returns a JSON string:
   cells      - how many cells across the drawn grid is, from the pitch between drawn grid lines
   lines      - how many grid-line columns were found (14 for a 13-cell board)
   pitch,pad  - the spacing and the inset, in canvas pixels
   theme,declaredGrid,parsedTo - what the page says its grid colour is, and what this probe read
   gridDelta  - how far the grid colour is from the most common (felt) colour on the scanned row
   nearCounts - how many pixels sit within 4 / 8 / 16 of the grid colour, so a null reading can be
                told from a board that was never painted
   rowColours - the three colours that occupy most of the middle row                      */
export const GRID_RAY = `window.__boardGeo = function () {
  var cv = document.getElementById('board'), c = cv.getContext('2d');
  var W = cv.width, H = cv.height, d = c.getImageData(0, 0, W, H).data;
  function parse(v) {
    var m = (v || '').trim().match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
    if (m) return [parseInt(m[1],16),parseInt(m[2],16),parseInt(m[3],16)];
    m = (v || '').trim().match(/rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)/);
    return m ? [+m[1],+m[2],+m[3]] : null;
  }
  var declared = (getComputedStyle(document.documentElement).getPropertyValue('--grid') || '').trim();
  var want = parse(declared);
  function dist(p,q){return Math.max(Math.abs(p[0]-q[0]),Math.abs(p[1]-q[1]),Math.abs(p[2]-q[2]));}
  function at(x,y){var i=(y*W+x)*4;return [d[i],d[i+1],d[i+2]];}
  /* how many sampled points along a vertical line sit at the grid colour */
  function columnIsGrid(x,tol){
    var n=0,used=0;
    for(var y=8;y<H-8;y+=3){used++;if(want&&dist(at(x,y),want)<=tol)n++;}
    return n > used*0.5;
  }
  /* pick the tolerance that separates the grid from the board's own surface: the row across the
     middle is mostly surface, so the tolerance at which almost nothing matches and the one at which
     the lines appear give a safe midpoint between them */
  var near={};
  [4,8,12,16,24,32].forEach(function(t){var n=0;for(var y=Math.round(H/2),x=0;x<W;x++){if(want&&dist(at(x,y),want)<=t)n++;}near[t]=n;});
  var tol=null;
  [4,8,12,16,24,32].forEach(function(t){if(tol===null&&near[t]>0&&near[t]<W*0.2)tol=t;});
  if(tol===null)tol=8;
  var hits=[];
  for(var x=0;x<W;x++){if(columnIsGrid(x,tol))hits.push(x);}
  var lines=[];for(var i=0;i<hits.length;i++)if(!lines.length||hits[i]-lines[lines.length-1]>2)lines.push(hits[i]);
  var gap=[];for(var i=1;i<lines.length;i++)gap.push(lines[i]-lines[i-1]);gap.sort(function(a,b){return a-b;});
  var pitch=gap.length?gap[gap.length>>1]:0,pad=lines.length?lines[0]:0;
  var row=Math.round(H/2),seen={},felt=null,feltN=0;
  for(var x=0;x<W;x++){var k=at(x,row).join(',');seen[k]=(seen[k]||0)+1;if(seen[k]>feltN){feltN=seen[k];felt=at(x,row);}}
  var top=Object.keys(seen).map(function(k){return [k,seen[k]];}).sort(function(a,b){return b[1]-a[1];});
  return JSON.stringify({
    canvas:[W,H],lines:lines.length,pitch:pitch,pad:pad,hitColumns:hits.length,toleranceUsed:tol,
    nearOnMiddleRow:near,
    cells:pitch?Math.round((W-2*pad)/pitch):0,
    theme:document.documentElement.getAttribute('data-theme')||'slate',
    declaredGrid:declared,parsedTo:want,
    gridMinusFelt:want&&felt?dist(want,felt):null,
    rowColours:top.slice(0,3).map(function(t){return t[0]+' x'+t[1];})
  });
};window.__boardGeo()`;

/* Aim at a cell centre from the grid geometry: cellX,cellY are 0-based grid coordinates. */
export const cellCentre = (geo, cellX, cellY) =>
  ({ x: geo.pad + (cellX + 0.5) * geo.pitch, y: geo.pad + (cellY + 0.5) * geo.pitch });
