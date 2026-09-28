import test from 'node:test';
import assert from 'node:assert/strict';
import {chartSpec,chartSVG,diagramSpec,diagramSVG} from '../dist/core/visual-tools.js';
const chart=chartSpec({title:'Spacing fixture',type:'line',labels:['A','B','C'],series:[{name:'Sample',values:[2,4,3]}]});
const viewBox=svg=>svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
const plotHeight=svg=>{const ys=[...svg.matchAll(/<line x1="[^"]+" y1="([^"]+)"/g)].map(m=>+m[1]);return Math.max(...ys)-Math.min(...ys);};
test('inline chart removes unused heading/axis-title space without shrinking its data plot',()=>{
 const normal=chartSVG(chart,[],{heading:false,compact:true,width:780});
 const tight=chartSVG(chart,[],{heading:false,compact:true,width:780,tight:true});
 assert.equal(viewBox(normal)[3]-viewBox(tight)[3],36);
 assert.equal(plotHeight(normal),plotHeight(tight));
});
test('mobile chart trims empty bands and retains its plot and readable viewBox width',()=>{
 const normal=chartSVG(chart,[],{heading:false,width:360});
 const tight=chartSVG(chart,[],{heading:false,width:360,tight:true});
 assert.equal(viewBox(tight)[2],360);assert.equal(viewBox(normal)[3]-viewBox(tight)[3],26);
 assert.equal(plotHeight(normal),plotHeight(tight));
});
test('a real x-axis title keeps its reserved line in tight previews',()=>{
 const withLabel={...chart,x_label:'Experiment number'};
 const base=chartSVG(withLabel,[],{heading:false,width:780});
 const tight=chartSVG(withLabel,[],{heading:false,width:780,tight:true});
 assert.equal(viewBox(base)[3]-viewBox(tight)[3],8);assert.match(tight,/>Experiment number<\/text>/);
 assert.equal(plotHeight(base),plotHeight(tight));
});
test('tight is display-only: headed and print chart exports stay byte-identical',()=>{
 for(const options of [{heading:true},{print:true},{print:true,heading:false}])
  assert.equal(chartSVG(chart,[],options),chartSVG(chart,[],{...options,tight:true}));
});
test('heading-free diagrams use content-sized vertical margins while headed exports stay intact',()=>{
 const spec=diagramSpec({title:'Flow',nodes:[{id:'a',label:'A',column:0,row:0},{id:'b',label:'B',column:1,row:1}],edges:[{from:'a',to:'b'}]});
 const headed=diagramSVG(spec,'arrow',true),inline=diagramSVG(spec,'arrow',false);
 assert.equal(viewBox(headed)[3],355);assert.equal(viewBox(inline)[3],233);
 for(const m of inline.matchAll(/<rect x="[^\"]+" y="([^\"]+)" width="180" height="55"/g))assert.ok(+m[1]>=24&&+m[1]+55<=233-24);
 assert.ok(!/NaN|Infinity/.test(inline));
});
