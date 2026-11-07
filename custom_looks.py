"""User-created outfit slots; creation never approves or selects images."""
import copy, re, time, uuid

def create(character, request):
 def field(key, limit, required=False):
  value=request.get(key,'')
  if not isinstance(value,str):raise ValueError(key+' must be text')
  value=value.strip()
  if len(value)>limit or (required and not value):raise ValueError('Enter '+key+' (up to '+str(limit)+' characters)')
  return value
 name=field('name',100,True); garments=field('garments',4000);condition=field('condition',2000)
 token=field('request_id',80,True)
 if not re.fullmatch(r'[a-zA-Z0-9-]{8,80}',token):raise ValueError('Invalid request ID')
 for look in character.get('looks',[]):
  if look.get('creation_request_id')==token:
   if [look['name'],look.get('custom_garments',''),look.get('custom_condition','')]!=[name,garments,condition]:raise ValueError('This request was already saved with different details')
   return look
 if any(l['name'].strip().casefold()==name.casefold() for l in character.get('looks',[])):raise ValueError('An outfit with this name already exists for this character. Choose a different name.')
 slug=re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')[:48] or 'costume'
 lid=character['id']+'--custom-'+slug+'-'+uuid.uuid4().hex[:8]
 def slot(category):return {'category':category,'status':'Missing','confirmed_ids':[],'candidate_ids':[],'obsolete_ids':[]}
 audit=character.get('reference_audit',{})
 look={'id':lid,'character_id':character['id'],'name':name,'stage':'custom','custom':True,'active_story':True,'created_at':time.time(),'creation_request_id':token,'required_by':'User-created custom costume','status':'Needed','custom_garments':garments,'custom_condition':condition,'garment_language':garments or 'Choose a costume seed from the wardrobe gallery; preserve its garments unless directed otherwise.','condition_language':condition or 'Preserve the condition of the chosen costume seed.','garment_evidence':'User-proposed custom wardrobe design; not established costume canon.','scope_note':'User-created custom costume exploration; not evidence of a scripted or historical outfit.','source_metadata':[],'generated_candidate_ids':[],'supporting_reference_ids':[],'generation_state':'Awaiting reference selection or generation','full_body':slot('Look-matched neutral full-body sheet'),'mannequin':{**slot('Mannequin outfit study'),'needed':True,'reason':'No clothing-only reference has been added to this custom outfit.'}}
 for key,label in [('portrait','Portrait / likeness'),('emotion_map','Emotion map'),('individual_emotion','Individual emotion')]:look[key]=copy.deepcopy(audit.get(key) or slot(label))
 look['shared_identity_anchor_ids']=list(dict.fromkeys(look['portrait'].get('confirmed_ids',[])+look['portrait'].get('candidate_ids',[])))
 common=f"Look ID: {lid}\nCharacter: {character['name']}\nCustom costume: {name}\nGarments: {look['garment_language']}\nCondition: {look['condition_language']}\n{look['scope_note']}\nKeep results unapproved until reviewed."
 look['proposed_character_sheet_brief']='PROPOSED CUSTOM COSTUME — NOT USED\n'+common+'\nChoose an exact likeness and costume seed before generating. Preserve the selected face, age and proportions. Show front, three-quarter and back views, complete head and footwear, neutral standing pose on a warm-gray studio background.'
 look['proposed_mannequin_prompt']='PROPOSED CUSTOM CLOTHING STUDY — NOT USED\n'+common+'\nShow front, side and back of a featureless headless dress form, complete garments and footwear, soft studio light. No recognizable person.'
 character.setdefault('looks',[]).append(look)
 return look
