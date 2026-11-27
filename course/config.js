/* Course-wide settings: the ONE place to change links and endpoints.
 * Leave a value empty ('') to switch that feature off; the pages hide it. */
window.HQ_CONFIG = {
    // Discord invite link, e.g. 'https://discord.gg/AbCdEf'. Empty = community boxes hidden.
    discord: 'https://discord.gg/KhuHhGTvV8',

    // Anonymous, cookieless usage counters (see course-worker/). Empty = no tracking.
    // Same-origin address, served by the course Worker's /course/api/e route.
    analytics: 'https://www.hieroglyphica.org/course/api/e',

    // Read-aloud (browser speech, free, no server). Set false to hide the Listen buttons.
    readAloud: true,

    // Play buttons on the alphabet page. Keep false until the teacher's recordings are in
    // course/audio/alphabet/ (see RECORDING.md there); then set true.
    alphabetAudio: true,

    // Members' classes (Class 6 onward). Keep false until the paid unlock serves them at this
    // address: until then the course home lists them without a link, because the public site
    // does not carry them. A local preview links them whatever this says.
    membersOpen: true,

    // The paid unlock (see course-worker/README.md). paymentLink: the Stripe Payment Link,
    // https://buy.stripe.com/… ; memberPrice: how the price reads on the members' page, e.g.
    // '€49'. The buy button shows only when membersOpen is true and paymentLink is set.
    paymentLink: 'https://buy.stripe.com/3cI4gycnC9wJflDgF34F201',
    memberPrice: '€49',

    // Early-access list (course-worker/README.md, "Early access and the early-bird price"): while
    // membersOpen is false, the course home, the end of Class 5 and the members' page ask for an
    // email address to tell when the members' course opens. Turn on only once the Worker's
    // /course/api/early route is deployed with RESEND_API_KEY and MAIL_FROM.
    earlyAccess: false,

    // Quick search (search.js; index built by tools/build-search.mjs). Built but not shown yet:
    // keep false until it is launched. To try it in a local preview, open any course page with
    // ?search (?search=0 turns it off again for that tab).
    search: false
};
