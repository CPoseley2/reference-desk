(function(root){
function setAngle(text,oldPhrase,nextPhrase){
 if(!oldPhrase)return {text:'Camera angle: '+nextPhrase+'.\n'+text,phrase:nextPhrase};
 const anchor='Camera angle: '+oldPhrase;
 const at=text.indexOf(anchor);
 if(at<0 || text.indexOf(anchor,at+1)>=0)return {text,phrase:oldPhrase,conflict:true};
 return {text:text.slice(0,at)+'Camera angle: '+nextPhrase+text.slice(at+anchor.length),phrase:nextPhrase};
}
// Adapted from Reference Desk Framework/exploration-core.js. Viewpoints never impose a crop.
const viewpointGroups=[
 {label:'Eye level',options:[
  ['Eye level','Place the camera at the subject’s eye level, with a level horizon.'],
  ['Three-quarter view','At eye level, view the subject from a three-quarter angle so both the front and one side are visible.'],
  ['Front view','At eye level, face the subject directly from the front.'],
  ['Profile','At eye level, view the subject in profile, perpendicular to their facing direction.'],
  ['Front-left three-quarter','At eye level, view the subject from their front-left, showing the front and left side.'],
  ['Front-right three-quarter','At eye level, view the subject from their front-right, showing the front and right side.'],
  ['Left profile','At eye level, show the subject’s left profile.'],
  ['Right profile','At eye level, show the subject’s right profile.']]},
 {label:'Low & ground level',options:[
  ['Slightly low angle','Place the camera slightly below the subject’s eye line, looking gently upward.'],
  ['Low angle · front','View the subject from the front with the camera below eye level, looking upward.'],
  ['Low angle · side','View the subject from the side with the camera below eye level, looking upward.'],
  ['Ground level','Place the camera close to the ground looking upward; maintain natural proportions without exaggerated lens distortion.']]},
 {label:'High & overhead',options:[
  ['Slightly high angle','Place the camera slightly above the subject’s eye line, looking gently downward.'],
  ['High angle · front','View the subject from the front with the camera above eye level, looking downward.'],
  ['High angle · side','View the subject from the side with the camera above eye level, looking downward.'],
  ['Overhead · straight down','Position the camera directly overhead, looking vertically down at the subject and surroundings.'],
  ['Overhead · diagonal','Position the camera high above the subject, looking diagonally down to retain depth and spatial relationships.']]},
 {label:'Rear views',options:[
  ['Rear three-quarter','View the subject from a rear three-quarter angle, with their head turned enough for the face to remain visible.'],
  ['Rear-left three-quarter','View the subject from their rear-left, with their head turned toward the camera.'],
  ['Rear-right three-quarter','View the subject from their rear-right, with their head turned toward the camera.']]},
 {label:'Over the shoulder',options:[
  ['Over the shoulder','Look past a foreground shoulder toward the subject or action; retain a small portion of the shoulder to establish the viewing position.']]}
];
const framingGroups=[
 {label:'Closer framing',options:[
  ['Mid shot · waist up','Frame from the waist up, with the head and hair fully visible and room for hands or props involved in the action.'],
  ['Close-up · head and shoulders','Frame the head and shoulders; prioritize the face and expression, with only the action detail that fits naturally in this crop.'],
  ['Extreme close-up · face detail','Frame a tight facial detail, such as the eyes and expression; intentional cropping of the head is expected, and the action is conveyed through gaze and expression.']]},
 {label:'Wider framing',options:[
  ['Full shot','Keep the entire head, hair, body and complete footwear visible, with comfortable margin and room for the action.'],
  ['Medium wide','Frame the subject from approximately the knees upward, allowing room for gestures and nearby action.'],
  ['Wide / establishing','Use a wide composition that establishes the setting and the subject’s position within it; preserve readable spatial relationships.']]}
];
const fields={viewpoint:{label:'Camera angle',pattern:/^[ \t]*(?:Camera angle|Camera|Viewpoint):[ \t]*(.*)$/gim},framing:{label:'Shot size',pattern:/^[ \t]*(?:Shot size|Framing):[ \t]*(.*)$/gim},movement:{label:'Movement',pattern:/^[ \t]*(?:Movement|Camera movement):[ \t]*(.*)$/gim}};
function entries(text,key){return [...text.matchAll(new RegExp(fields[key].pattern))].map(m=>({text:m[0],value:m[1].trim(),index:m.index}));}
function readDirection(text){return Object.fromEntries(Object.keys(fields).map(key=>[key,entries(text,key)[0]?.value||'']));}
function applyDirection(text,base,patch){
 const original=text,edits=[],prefix=[],newline=text.includes('\r\n')?'\r\n':'\n';
 for(const key of Object.keys(fields)){
  if(!Object.hasOwn(patch,key))continue;
  const value=patch[key].trim().replace(/\s*\r?\n\s*/g,' ');
  if(!value)return {text,error:'Enter '+fields[key].label.toLowerCase()+' wording, or use Reset preview to keep the current line.'};
  const now=entries(text,key),before=entries(base,key);
  if(now.length>1||before.length>1)return {text,error:'More than one '+fields[key].label.toLowerCase()+' line was found. Resolve the duplicate lines in Editable video text, then reset the preview.'};
  if(JSON.stringify(now.map(x=>x.text))!==JSON.stringify(before.map(x=>x.text)))return {text,error:fields[key].label+' changed in Editable video text. Reset the preview to use that edit before applying.'};
  const line=fields[key].label+': '+value;
  if(now.length)edits.push({index:now[0].index,length:now[0].text.length,line});else prefix.push(line);
 }
 for(const edit of edits.sort((a,b)=>b.index-a.index))text=text.slice(0,edit.index)+edit.line+text.slice(edit.index+edit.length);
 if(prefix.length)text=prefix.join(newline)+newline+text;
 if(text.length>30000)return {text:original,error:'The resulting video prompt exceeds 30,000 characters. Shorten the wording before applying.'};
 return {text};
}
const api={setAngle,viewpointGroups,framingGroups,readDirection,applyDirection,copyText:shot=>shot.video_prompt};
if(typeof module!=='undefined')module.exports=api;else root.PromptControls=api;
})(globalThis);
