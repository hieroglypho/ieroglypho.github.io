/* Course-wide settings: the ONE place to change links and endpoints.
 * Leave a value empty ('') to switch that feature off; the pages hide it. */
window.HQ_CONFIG = {
    // Discord invite link, e.g. 'https://discord.gg/AbCdEf'. Empty = community boxes hidden.
    discord: 'https://discord.gg/UJ7Xq2cT5',

    // Anonymous, cookieless usage counters (see course-worker/). Empty = no tracking.
    // e.g. 'https://hieroglyphica-course.<you>.workers.dev/e'
    analytics: '',

    // Read-aloud (browser speech, free, no server). Set false to hide the Listen buttons.
    readAloud: true,

    // Play buttons on the alphabet page. Keep false until the teacher's recordings are in
    // course/audio/alphabet/ (see RECORDING.md there); then set true.
    alphabetAudio: false
};
