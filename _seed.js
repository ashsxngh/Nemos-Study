// Seed data injected into the page's IndexedDB + localStorage before load.
// Mirrors the zustand persist shapes: nemos-library / nemos-history in IDB,
// nemos-exams / nemos-notes / nemos-app / nemos-settings / nemos-trash in localStorage.
window.__seedNemos = async function () {
  const USER = 'local-user'
  const now = Date.now()
  const iso = (msAgo) => new Date(now - msAgo).toISOString()
  const DAY = 86400000

  // ---- Folders ----
  const folders = [
    { id: 'fold-med', userId: USER, parentId: null, name: 'Medical School', color: 'blue', isStarred: true, isArchived: false, order: 0, createdAt: iso(90*DAY), updatedAt: iso(2*DAY) },
    { id: 'fold-path', userId: USER, parentId: 'fold-med', name: 'Pathology', color: 'red', isStarred: false, isArchived: false, order: 1, createdAt: iso(80*DAY), updatedAt: iso(2*DAY) },
  ]

  // ---- Decks ----
  const deckDefs = [
    { id: 'deck-cardio', name: 'Cardiovascular', folderId: 'fold-path', desc: 'Heart mechanics, valves, and vascular pathology.', starred: false },
    { id: 'deck-cycle', name: 'Cardiac Cycle', folderId: 'fold-path', desc: 'Mastering pressure-volume loops and Wiggers diagram.', starred: false },
    { id: 'deck-valve', name: 'Valvular Disorders', folderId: 'fold-path', desc: 'Stenosis, regurgitation, and auscultatory findings.', starred: false },
    { id: 'deck-ecg', name: 'ECG Interpretation', folderId: 'fold-path', desc: 'Axis deviation, arrhythmias, and ischemia patterns.', starred: true },
    { id: 'deck-pharm', name: 'Pharmacology', folderId: 'fold-med', desc: 'Drug classes, mechanisms, and side effects.', starred: false },
    { id: 'deck-neuro', name: 'Neuroanatomy', folderId: 'fold-med', desc: 'Tracts, nuclei, and clinical localization.', starred: false },
  ]
  const decks = deckDefs.map((d, i) => ({
    id: d.id, userId: USER, folderId: d.folderId, name: d.name, description: d.desc,
    isStarred: d.starred, isArchived: false, tags: [], order: i,
    createdAt: iso((70 - i) * DAY), updatedAt: iso((i + 1) * DAY),
  }))

  // ---- Cards + FSRS ----
  const cardsFront = [
    'Approximate phenotypic ratio from crossing two heterozygous plants?',
    'What ion is responsible for the plateau phase of the cardiac action potential?',
    'Which valve is best heard at the 2nd right intercostal space?',
    'Define preload in terms of the Frank-Starling mechanism.',
    'What ECG finding is pathognomonic for hyperkalemia?',
    'Mechanism of action of beta-blockers on the heart?',
    'Which cranial nerve is affected in a lesion of the cavernous sinus?',
    'What is the most common cause of aortic stenosis in the elderly?',
    'Name the drug class ending in "-pril".',
    'What does a widened QRS complex indicate?',
    'Which layer of the heart is affected in Dressler syndrome?',
    'What is the half-life determinant in first-order kinetics?',
  ]
  const cards = []
  const fsrsData = {}
  const reviewLogs = []
  const sessions = []
  let cardCounter = 0

  // distribute cards across decks with varied FSRS states
  deckDefs.forEach((d, di) => {
    const nCards = [40, 24, 18, 32, 60, 45][di]
    for (let i = 0; i < nCards; i++) {
      const id = `card-${d.id}-${i}`
      cardCounter++
      const front = cardsFront[(di * 3 + i) % cardsFront.length]
      cards.push({
        id, deckId: d.id, userId: USER, type: 'basic',
        front, back: 'Answer content for this card.',
        tags: [], isPinned: false, isArchived: false,
        linkedCardIds: [], prerequisiteCardIds: [], order: i,
        createdAt: iso((60 - di) * DAY), updatedAt: iso((di + 1) * DAY),
      })
      // FSRS state: mix of new / learning / review / relearning
      const r = (di * 7 + i) % 10
      let state, stability, difficulty, dueMs, lastMs, reps, lapses
      if (r < 2) { state = 'new'; stability = 0; difficulty = 0; dueMs = 0; lastMs = null; reps = 0; lapses = 0 }
      else if (r < 3) { state = 'learning'; stability = 0.5; difficulty = 6.2; dueMs = -0.2*DAY; lastMs = 0.3*DAY; reps = 1; lapses = 0 }
      else if (r < 4) { state = 'relearning'; stability = 1.2; difficulty = 7.8; dueMs = -1*DAY; lastMs = 1*DAY; reps = 4; lapses = 2 }
      else { state = 'review'; stability = 8 + (i % 30); difficulty = 4 + (i % 5); dueMs = (di % 2 === 0 ? -1 : 3) * DAY; lastMs = (5 + i % 10) * DAY; reps = 3 + (i % 8); lapses = i % 3 }
      fsrsData[id] = {
        cardId: id, userId: USER, stability, difficulty,
        retrievability: state === 'review' ? 0.7 + (i % 3) * 0.1 : 0,
        dueDate: iso(-dueMs), lastReviewedAt: lastMs === null ? null : iso(lastMs),
        repetitions: reps, lapses, state,
      }
    }
  })

  // ---- Review logs across ~90 days for heatmap/streak/stats ----
  let logCounter = 0
  for (let d = 90; d >= 0; d--) {
    // skip a few days to make streak realistic
    if (d === 40 || d === 41 || d === 63) continue
    const reviewsToday = 20 + Math.floor(40 * Math.abs(Math.sin(d * 0.7)))
    const sessId = `sess-${d}`
    sessions.push({
      id: sessId, userId: USER, deckId: deckDefs[d % deckDefs.length].id,
      startedAt: iso(d * DAY + 3600000), endedAt: iso(d * DAY),
      cardsReviewed: reviewsToday, cardsCorrect: Math.floor(reviewsToday * 0.85),
      cardsIncorrect: Math.ceil(reviewsToday * 0.15), averageResponseMs: 3400, mode: 'standard',
    })
    for (let k = 0; k < reviewsToday; k++) {
      const cd = cards[(logCounter * 3) % cards.length]
      const rating = (k % 7 === 0) ? 1 : (k % 5 === 0 ? 2 : 4)
      reviewLogs.push({
        id: `log-${logCounter++}`, sessionId: sessId, cardId: cd.id, userId: USER,
        rating, responseMs: 2000 + (k % 10) * 400,
        reviewedAt: iso(d * DAY + k * 60000),
        scheduledInterval: 4 + (k % 20), ease: 5, wasNew: k < 4,
      })
    }
  }

  // ---- pendingDeletes buckets (five-bucket shape) ----
  const pendingDeletes = { folders: [], decks: [], cards: [], sessions: [], reviewLogs: [] }

  const libraryState = {
    state: { folders, decks, cards, fsrsData, pendingDeletes },
    version: 0,
  }
  const historyState = {
    state: { reviewLogs, sessions },
    version: 0,
  }

  // ---- Exams (localStorage) ----
  const exams = [
    { id: 'exam-usmle', userId: USER, name: 'USMLE Step 2', subject: 'Comprehensive', date: iso(-14*DAY), priority: 'high', deckIds: ['deck-cardio','deck-pharm'], folderIds: ['fold-med'], targetRetention: 0.9, createdAt: iso(60*DAY) },
    { id: 'exam-cardio', userId: USER, name: 'Cardiology Block', subject: 'Cardiovascular', date: iso(-6*DAY), priority: 'medium', deckIds: ['deck-cycle','deck-valve'], folderIds: [], targetRetention: 0.85, createdAt: iso(40*DAY) },
  ]

  // ---- Notes (localStorage) ----
  const notes = [
    { id: 'note-bb', userId: USER, folderId: 'fold-med', title: 'Pharmacology of Beta-Blockers', content: 'Beta-blockers (Beta-Adrenergic Antagonists) are a diverse class of drugs primarily used for cardiovascular conditions. They work by blocking the binding of epinephrine and norepinephrine to beta-receptors.\n\n1. Receptor Selectivity\n- Beta-1 Selective: (Cardioselective) Atenolol, Metoprolol, Esmolol. Mnemonic: "A to M".\n- Non-selective: Propranolol, Nadolol, Timolol. Mnemonic: "N to Z".\n- Mixed Alpha/Beta: Carvedilol, Labetalol. Useful in heart failure and hypertensive emergencies.\n\n2. Clinical Applications\nPrimarily used in Hypertension, Angina Pectoris, Myocardial Infarction, and Heart Failure.', isStarred: true, isArchived: false, tags: ['Pharmacology','USMLE Step 1'], linkedNoteIds: [], embeddedCardIds: [], createdAt: iso(5*DAY), updatedAt: iso(120000) },
    { id: 'note-gfr', userId: USER, folderId: 'fold-med', title: 'Renal Physiology - GFR', content: 'Calculation of Glomerular Filtration Rate using Creatinine clearance and the effect of afferent vs efferent arteriolar constriction.', isStarred: false, isArchived: false, tags: ['Renal'], linkedNoteIds: [], embeddedCardIds: [], createdAt: iso(10*DAY), updatedAt: iso(3*3600000) },
    { id: 'note-valve', userId: USER, folderId: 'fold-path', title: 'Cardiology: Valve Diseases', content: 'Distinguishing Mitral Stenosis from Aortic Regurgitation through physical exam findings.', isStarred: false, isArchived: false, tags: ['Cardiology'], linkedNoteIds: [], embeddedCardIds: [], createdAt: iso(30*DAY), updatedAt: iso(1*DAY) },
    { id: 'note-brain', userId: USER, folderId: 'fold-med', title: 'Neurology: Brainstem Lesions', content: 'Localization of lesions based on cranial nerve involvement and long-tract signs (Rule of 4).', isStarred: false, isArchived: false, tags: ['Neurology'], linkedNoteIds: [], embeddedCardIds: [], createdAt: iso(45*DAY), updatedAt: iso(20*DAY) },
  ]

  // ---- Trash (localStorage) ----
  const trashState = {
    state: {
      items: [
        { id: 'trash-1', type: 'deck', name: 'Pathology: Cardiovascular System', cardCount: 124, deletedAt: iso(2*DAY) },
        { id: 'trash-2', type: 'note', name: 'Antibiotics Mechanism Summary', deletedAt: iso(5*DAY) },
        { id: 'trash-3', type: 'deck', name: 'Pharmacology: Autonomic Drugs', cardCount: 86, deletedAt: iso(7*DAY) },
        { id: 'trash-4', type: 'deck', name: 'Microbiology: Gram-Positive Bacteria', cardCount: 210, deletedAt: iso(13*DAY) },
      ],
    },
    version: 0,
  }

  // ---- App store (localStorage): theme + planner tasks ----
  const appState = {
    state: {
      theme: 'dark', sidebarCollapsed: false, lastOpenDeckId: null, lastOpenNoteId: null,
      lastBurnoutNudgeAt: null,
      plannerTasks: [
        { id: 'pt-1', label: 'Review high-yield Heart Murmurs', done: false },
        { id: 'pt-2', label: 'Complete Neurology import', done: true },
        { id: 'pt-3', label: "Watch 'Pathology of Renal Failure'", done: false },
        { id: 'pt-4', label: 'Update FSRS stability parameters', done: false },
      ],
    },
    version: 0,
  }

  // Write localStorage entries
  localStorage.setItem('nemos-exams', JSON.stringify({ state: { exams, pendingDeletedExams: [] }, version: 0 }))
  localStorage.setItem('nemos-notes', JSON.stringify({ state: { notes, pendingDeletedNotes: [] }, version: 0 }))
  localStorage.setItem('nemos-trash', JSON.stringify(trashState))
  localStorage.setItem('nemos-app', JSON.stringify(appState))

  // Write IndexedDB entries (nemos-idb / store 'kv')
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('nemos-idb', 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
    }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('kv', 'readwrite')
      const store = tx.objectStore('kv')
      store.put(JSON.stringify(libraryState), 'nemos-library')
      store.put(JSON.stringify(historyState), 'nemos-history')
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  })

  return { decks: decks.length, cards: cards.length, logs: reviewLogs.length }
}
