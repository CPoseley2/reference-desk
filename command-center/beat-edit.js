/* Cut editing is enabled only for an explicitly configured version. */
window.initBeatEdit=async function(view,catalog){
 if(view.beat_timing_configured && window.initCrescendoCutEdit)return window.initCrescendoCutEdit(view,catalog);
};
