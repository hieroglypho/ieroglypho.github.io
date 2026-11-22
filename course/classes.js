/* The class catalogue: the ONE list of classes, used by the course home, the
 * class bar on every class page (previous / next / all classes), the finish
 * banner's "next class" button, the review page and the search.
 *
 * When a class is built: give it its blurb and its folder ('class-NN/').
 * A class with folder null is listed as "coming" and never linked.
 * Load before course.js: <script src="../classes.js"></script>          */
window.HQ_CLASSES = {
    FREE: 5,                     // Classes 1..FREE are free (must match tools/deploy-free.sh)
    TOTAL: 30,
    MODULES: {
        a: 'Module A · The script',
        b: 'Module B · Nouns and sentences without verbs',
        c: 'Module C · The verb',
        d: 'Module D · Clauses and real reading'
    },
    // [module, no, title, blurb, folder or null]
    LIST: [
        ['a', 1, 'Read Like Champollion', 'How the script works · direction & groups · crack four royal cartouches', 'class-01/'],
        ['a', 2, 'The Egyptian “Alphabet” I', 'The first twelve one-consonant signs · transliteration · reading by sound · a royal family at Saqqara', 'class-02/'],
        ['a', 3, 'The Egyptian “Alphabet” II', 'The other thirteen one-consonant signs · the four h’s · dictionary order · phonetic complements · Khufu and Tutankhamun', 'class-03/'],
        ['a', 4, 'Two- and Three-Consonant Signs', 'Eighteen of the most common big signs · word-sign or sound-sign · how a spelling is built · Imhotep, Memphis and Pharaoh', 'class-04/'],
        ['a', 5, 'Kings and Gods', 'Determinatives · plurals and gods-first spellings · the five royal names · capstone: read the Abydos king list', 'class-05/'],
        ['b', 6, 'Nouns', 'Masculine and feminine · plural and dual · no “the”, no “and” · two ways to say “of” · the titles of a queen', 'class-06/'],
        ['b', 7, 'Pronouns', 'Suffixes that say whose · the invisible “my” · pronouns that stand alone · “this” and “that” · His Majesty and a family stela', 'class-07/'],
        ['b', 8, 'Adjectives', 'After the noun, with its endings · “every” or “lord” · good of face, true of voice · nisbes · the great god and the great royal wife', 'class-08/'],
        ['b', 9, 'Prepositions and the Offering Formula', 'In, to, on, with · suffixes after prepositions · “who is in”: titles and epithets · the offering formula · a prayer for Imhotep', 'class-09/'],
        ['b', 10, 'Sentences Without Verbs I', 'No word for “is” · he is good, how good it is! · I am, you are · it is: pw · names, families and “who?” · Imhotep speaks', 'class-10/'],
        ['b', 11, 'Sentences Without Verbs II', 'Where things are: jw, “look!” and “not” · having and not having · numerals from 1 to a million · reading a date · the steward’s report', 'class-11/'],
        ['b', 12, 'Capstone: an Offering Stela', 'Saying no with nj … js · how a stela is laid out · the real stela of the steward Mentuwoser, read on the stone · a whole offering stela, top to bottom · Module B capstone check', 'class-12/'],
        ['c', 13, 'Verbs and the Infinitive', 'What a verb does · roots, weak verbs and causatives · the infinitive and its t · who does it, and to what · captions, spell titles and “in order to” · Imhotep goes to Abydos', 'class-13/'],
        ['c', 14, 'The Pseudo-verbal Construction', 'An action where the place was: he is listening · ḥr, r and m: happening, still to come, on the way · “then” in stories · “one”, “not” and “are you?” · Imhotep at the feast of Abydos', 'class-14/'],
        ['c', 15, 'Commands and Particles', 'Giving orders: listen!, come!, give me water! · who is told, and what · “don’t” with m · particles for perhaps, surely, but and now · Imhotep teaches his son to write', 'class-15/'],
        ['c', 16, 'The Stative', 'States, not actions: I have arrived, I am well, your name is written · the endings .kw and .tj · subject first · welcome! and farewell! · the royal names that are statives · Imhotep’s letter home from Abydos', 'class-16/'],
        ['c', 17, 'The sḏm.n.f', 'Actions done: I have seen the god, then he found his son · the n after the verb · verb first, subject after · state or deed? · has done, did, had done · the gods’ gift: I have given you all life · nj sḏm.n.f “cannot” · Imhotep comes home from Abydos', 'class-17/'],
        ['c', 18, 'The sḏm.f I', 'A verb and its subject, no n: may he live, let us go, I will see the god · polite commands to a king · the offering prayer’s “may he give” · habits and general truths after jw · nj sḏm.f “did not” vs nj sḏm.n.f “cannot” · Imhotep’s promise to his son', 'class-18/'],
        ['c', 19, 'The sḏm.f II', 'The words in front of the verb: jr “if” and tm “if not” · ḥꜣ “if only” · jḫ, kꜣ “so” and ḫr “has to” · nn sḏm.f “will not”, nn zp “never” · jm.f sḏm “may he not” · questions with jn · Imhotep and his son on the road to Abydos', 'class-19/'],
        ['c', 20, 'To Be, and the Passive', 'One says, he is heard: the form with tw · his name was written: the passive, with jn “by” · was, will be, will remain: wn and wnn · there is, there is no, is there? · Imhotep’s son at Abydos', 'class-20/'],
        ['c', 21, 'So He Said: the Last Suffix Forms', 'Tags after the verb: ḏd.jn.f “so he said”, dwꜣ.ḫr.k “you have to praise”, mꜣ.kꜣ.k “then you will see” · the t inside the verb: nj sḏmt.f “before he heard”, r sḏmt.f “until” · ḫr.f “says he” · checkpoint reading for Module C: Imhotep and his son walk home', 'class-21/'],
        ['d', 22, 'While He Was Sitting: Clauses That Set the Scene', 'A sentence with two statements · “while he was…”: jw.f ḥr jjt · “I found him sitting”: the stative in a clause · whose state is it? · jst “while, although” · ꜥnḫ.w ḏt and ꜥ.w.s. after names · Imhotep comes home', 'class-22/'],
        ['d', 23, 'Having Done, So That: Clauses in Time', 'When did it happen? · before: the sḏm.n.f, “having eaten”, “bringing” · at the same time: “I found him writing” · captions · after: “so that”, “come and tell me” · without: nn, nj sḏm.n.f, tm · wn and wnn · Imhotep at the palace', 'class-23/'],
        ['d', 24, 'I Know That He Has Come: Noun Clauses', 'What was said? ntt “that”, ntt.f, ntt wj · no marker: “I know he has come” · why? ḥr ntt, n ntt “because” · mj mrr.k “as you wish” · who made it happen? rdj + sḏm.f, jmj · tm · a real line: Ahmose son of Ibana · find the scribe’s mistake · a letter from the palace', 'class-24/'],
        ['d', 25, 'The Stela That I Set Up: Relative Clauses', 'Which one? ntj, ntjw, ntt “who is” · the house he is in: a pronoun pointing back · without: jwtj, jwtj n.f · “a scribe called Imhotep”: no marker after a new noun · “the stela that I set up”: the relative sḏm.n.f, jrt.n.f “what he has done” · a real line: Ahmose’s motto · a letter home', 'class-25/'],
        ['d', 26, 'The Son He Loves: Relative Forms', 'The relative sḏm.f: zꜣ.f mrr.f “his son, whom he loves” · once or always? plain and doubled stems · jrt.n.k “what you have done”, ptr jrt.n.k “What have you done?”, NAME ḏd.f · tmt.f sḏm “what he will not hear” · ḥtp dj nswt taken apart · a real name: Ptolemy, beloved of Ptah · a father’s answer', 'class-26/'],
        ['d', 27, 'Participles', '', null],
        ['d', 28, 'Emphatic Sentences', '', null],
        ['d', 29, 'Reading: The Shipwrecked Sailor', '', null],
        ['d', 30, 'Reading: Sinuhe', '', null]
    ]
};
