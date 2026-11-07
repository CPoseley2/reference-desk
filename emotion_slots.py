"""Named emotion slots. Existing unscoped selections remain untouched."""
import re
DEFAULTS=['Calm','Joy','Concern','Fear','Anger','Grief','Determination']
PREFIX='individual-emotion:'
def name(value):
 if not isinstance(value,str):raise ValueError('Enter an emotion name')
 value=' '.join(value.split())
 if not 1<=len(value)<=80 or any(ch in value for ch in '@:<>') or any(ord(ch)<32 for ch in value):raise ValueError('Use an emotion name of 1–80 characters without @, :, < or >')
 return value

def valid_role(role):
 if not isinstance(role,str) or not role.startswith(PREFIX):return False
 try:return name(role[len(PREFIX):])==role[len(PREFIX):]
 except ValueError:return False

def create(character,request):
 label=name(request.get('name'))
 # Case-insensitive lookup keeps repeated submissions idempotent.
 for existing in DEFAULTS+character.get('individual_emotions',[]):
  if existing.casefold()==label.casefold():return existing
 character.setdefault('individual_emotions',[]).append(label)
 return label
