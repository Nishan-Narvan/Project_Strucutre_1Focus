import { addDays, today, uid } from "./date";
import { buildSessions } from "./schedule";
import type { AppState, Goal, Module, Resource, Roadmap, SourceType, Task, TaskKind } from "./types";

// Compact builders so the demo roadmaps stay readable.
const r = (source_type: SourceType, title: string, url: string, why: string, verified = true): Resource => ({ title, url, source_type, why, verified });
const t = (title: string, minutes: number, kind: TaskKind, detail: string): Omit<Task, "id"> => ({ title, minutes, kind, detail });

function mod(
  prefix: string,
  i: number,
  m: Omit<Module, "id" | "tasks"> & { tasks: Omit<Task, "id">[] },
): Module {
  return { ...m, id: `${prefix}m${i}`, tasks: m.tasks.map((x, j) => ({ ...x, id: `${prefix}m${i}t${j}` })) };
}

// ---------------------------------------------------------------- DSA

const dsaRoadmap: Roadmap = {
  title: "Data Structures & Algorithms for Coding Interviews",
  summary:
    "A 10-week path from basic Python fluency to solving medium LeetCode problems under time pressure. Every structure is derived from how memory and time actually behave, then drilled with pattern-based practice the r/leetcode community converges on (NeetCode 150 / Grind 75).",
  first_principles: [
    { principle: "Memory is either contiguous or linked", explanation: "Arrays give O(1) index access because addresses are computable; linked structures trade that for O(1) insertion. Every data structure is a mix of the two." },
    { principle: "Cost = work per step × number of steps", explanation: "Big-O is just counting how many times the innermost operation runs as input grows." },
    { principle: "Trade space for time", explanation: "Hash maps, memoisation and prefix sums all store extra information so you don't recompute it." },
    { principle: "Big problems are small problems repeated", explanation: "Recursion, divide-and-conquer, trees and dynamic programming are all the same idea: solve a smaller instance and combine." },
    { principle: "Order unlocks speed", explanation: "Sorted data enables binary search, two pointers and greedy choices." },
  ],
  zpd: {
    can_do_alone: ["Write loops, functions and lists in Python", "Solve LeetCode easy problems with brute force"],
    can_do_with_guidance: ["Analyse time complexity", "Use hash maps to optimise", "Write recursive functions"],
    out_of_reach_now: ["Dynamic programming from scratch", "Graph algorithms under time pressure", "System-level optimisation"],
    strategy:
      "Start at complexity analysis and arrays (just above current ability) with worked examples, then fade to timed independent solves. Each pattern is first seen in a NeetCode walkthrough, then re-solved blind 48 h later.",
  },
  diagram_mermaid: `flowchart TD
  P1["Memory layout"] --> M1
  P2["Counting steps"] --> M1
  M1["1 Complexity and Arrays"] --> M2["2 Hashing and Two Pointers"]
  M2 --> M3["3 Linked Lists Stacks Queues"]
  P4["Recursion"] --> M4
  M3 --> M4["4 Trees and Recursion"]
  M4 --> M5["5 Graphs and BFS DFS"]
  M4 --> M6["6 Dynamic Programming"]
  P3["Space for time"] --> M6
  M5 --> M7["7 Mock Interviews"]
  M6 --> M7`,
  modules: [],
  verification: {
    confidence_score: 88,
    consensus_notes:
      "Reddit (r/leetcode, r/cscareerquestions), NeetCode and the Tech Interview Handbook agree on pattern-first practice over random problem grinding, and on hashing → two pointers → trees → graphs → DP ordering.",
    changes_made: [
      "Moved recursion warm-up before trees (reviewers flagged recursion as the #1 blocker for tree problems).",
      "Added spaced re-solve review tasks after every module.",
      "Replaced an outdated course link with MIT 6.006 (2020).",
    ],
    open_risks: ["DP module is tight for a beginner at 1.5 h/day — buffer days are allocated after it.", "Mock interviews need a partner; Pramp/peers suggested."],
  },
};
dsaRoadmap.modules = [
  mod("dsa", 0, {
    title: "Complexity & Arrays", level: "Beginner → Novice", estimated_hours: 9,
    objective: "Analyse any loop-based solution's time and space complexity and solve array problems.",
    first_principle: "Contiguous memory and counting steps", zpd_scaffold: "Worked complexity examples first, then you predict Big-O before running code.",
    key_concepts: ["Big-O / Θ", "Amortised cost", "Dynamic arrays", "Prefix sums", "Sliding window"],
    checkpoint: "Explain the complexity of 5 unseen snippets and solve 'Maximum Subarray' in under 20 min.",
    resources: [
      r("youtube", "NeetCode — Big-O Notation in 5 minutes & array playlists", "https://www.youtube.com/@NeetCode", "Most recommended interview-prep channel on r/leetcode."),
      r("course", "MIT 6.006 Introduction to Algorithms (2020)", "https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/", "Rigorous foundations from first principles."),
      r("docs", "VisuAlgo — array & sorting visualisations", "https://visualgo.net/en", "See what the algorithm does to memory step by step."),
    ],
    tasks: [
      t("Watch: Big-O fundamentals and take notes", 45, "learn", "Write one-line definitions of O(1), O(log n), O(n), O(n log n), O(n²)."),
      t("Predict complexity of 10 code snippets", 40, "practice", "Write your guess first, then verify by counting steps."),
      t("Implement a dynamic array from scratch", 60, "project", "Support append, get, resize; measure amortised append cost."),
      t("Solve 4 array easies (Two Sum brute force, Contains Duplicate, …)", 75, "practice", "Timebox 20 min each; write complexity in a comment."),
      t("Learn sliding window + prefix sums", 50, "learn", "NeetCode walkthroughs; draw the window on paper."),
      t("Solve 3 sliding-window problems", 75, "practice", "Best Time to Buy/Sell Stock, Longest Substring w/o Repeating, Min Size Subarray Sum."),
      t("Review: re-solve 2 problems blind", 40, "review", "No notes. Compare against your first attempt."),
      t("Checkpoint quiz", 35, "quiz", "Module checkpoint — timed."),
    ],
  }),
  mod("dsa", 1, {
    title: "Hashing & Two Pointers", level: "Novice", estimated_hours: 9,
    objective: "Recognise when a hash map or two pointers turns O(n²) into O(n).",
    first_principle: "Trade space for time; order unlocks speed", zpd_scaffold: "Brute force first, then guided optimisation prompts, then independent.",
    key_concepts: ["Hash functions & collisions", "Frequency maps", "Two pointers", "Sorting + scan"],
    checkpoint: "Solve 'Group Anagrams' and '3Sum' unaided in 45 min total.",
    resources: [
      r("article", "Tech Interview Handbook — Grind 75", "https://www.techinterviewhandbook.org/grind75", "Community-favourite curated list with week-by-week plan."),
      r("reddit", "r/leetcode — pattern-based study advice", "https://www.reddit.com/r/leetcode/", "Consensus: learn patterns, not problems."),
      r("docs", "NeetCode Roadmap", "https://neetcode.io/roadmap", "Visual dependency map of interview patterns."),
    ],
    tasks: [
      t("Build a hash map with chaining", 70, "project", "Implement put/get/remove; test collision handling."),
      t("Solve 4 hashing problems", 80, "practice", "Two Sum (optimal), Valid Anagram, Group Anagrams, Top K Frequent."),
      t("Learn two-pointer pattern", 40, "learn", "Opposite-ends vs same-direction pointers."),
      t("Solve 4 two-pointer problems", 80, "practice", "Valid Palindrome, Two Sum II, 3Sum, Container With Most Water."),
      t("Review: spaced re-solve of Module 1 + 2", 45, "review", "Pick 3 problems you struggled with."),
      t("Checkpoint quiz", 40, "quiz", "Module checkpoint — timed."),
    ],
  }),
  mod("dsa", 2, {
    title: "Linked Lists, Stacks & Queues", level: "Novice → Intermediate", estimated_hours: 8,
    objective: "Manipulate pointers confidently and use stacks/queues for order-dependent problems.",
    first_principle: "Linked memory", zpd_scaffold: "Draw every pointer change on paper before coding.",
    key_concepts: ["Pointer rewiring", "Fast/slow pointers", "Monotonic stack", "Deque"],
    checkpoint: "Reverse a linked list iteratively and recursively; solve 'Daily Temperatures'.",
    resources: [
      r("youtube", "Abdul Bari — data structures lectures", "https://www.youtube.com/@abdul_bari", "Clear whiteboard derivations, popular on r/learnprogramming."),
      r("docs", "VisuAlgo — linked list", "https://visualgo.net/en/list", "Animate pointer operations."),
    ],
    tasks: [
      t("Implement singly + doubly linked list", 60, "project", "Insert, delete, reverse."),
      t("Solve 4 linked list problems", 80, "practice", "Reverse List, Merge Two Lists, Linked List Cycle, Reorder List."),
      t("Learn stacks, queues, monotonic stack", 45, "learn", "When does LIFO/FIFO order matter?"),
      t("Solve 4 stack problems", 80, "practice", "Valid Parentheses, Min Stack, Daily Temperatures, Car Fleet."),
      t("Review + checkpoint", 50, "quiz", "Re-solve 2 old problems then the checkpoint."),
    ],
  }),
  mod("dsa", 3, {
    title: "Trees & Recursion", level: "Intermediate", estimated_hours: 11,
    objective: "Think recursively and solve tree traversal / BST problems.",
    first_principle: "Big problems are small problems repeated", zpd_scaffold: "Recursion warm-ups with call-stack tracing, then tree templates, then blind solves.",
    key_concepts: ["Recursion & call stack", "DFS orders", "BFS level order", "BST invariants", "Heaps"],
    checkpoint: "Solve 'Lowest Common Ancestor of BST' and 'Binary Tree Level Order Traversal' in 40 min.",
    resources: [
      r("youtube", "NeetCode — Trees playlist", "https://www.youtube.com/@NeetCode", "Pattern templates reused across 20+ problems."),
      r("book", "Introduction to Algorithms (CLRS), ch. 12–13", "https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/", "Authoritative BST theory."),
    ],
    tasks: [
      t("Recursion warm-up: trace 5 functions by hand", 45, "learn", "Factorial, fib, power set — draw the call stack."),
      t("Implement BST insert/search/delete", 70, "project", "Test with random inputs."),
      t("Solve 5 DFS tree problems", 100, "practice", "Invert Tree, Max Depth, Same Tree, Subtree of Another Tree, Diameter."),
      t("Solve 3 BFS / BST problems", 75, "practice", "Level Order, Validate BST, Kth Smallest in BST."),
      t("Heaps & priority queues", 60, "learn", "Implement a min-heap; solve Kth Largest Element."),
      t("Review + checkpoint", 50, "quiz", "Spaced re-solve then checkpoint."),
    ],
  }),
  mod("dsa", 4, {
    title: "Graphs: BFS, DFS & Topological Sort", level: "Intermediate", estimated_hours: 10,
    objective: "Model problems as graphs and pick the right traversal.",
    first_principle: "Everything connected is a graph", zpd_scaffold: "Start with grids (familiar 2D arrays), then adjacency lists.",
    key_concepts: ["Adjacency list", "Visited sets", "Grid BFS", "Topological sort", "Union-Find"],
    checkpoint: "Solve 'Number of Islands' and 'Course Schedule' unaided.",
    resources: [
      r("docs", "cp-algorithms — graph section", "https://cp-algorithms.com/", "Precise reference implementations."),
      r("article", "LeetCode Top Interview 150", "https://leetcode.com/studyplan/top-interview-150/", "Official curated graph problems."),
    ],
    tasks: [
      t("Learn graph representations + BFS/DFS", 50, "learn", "Code both on the same small graph."),
      t("Solve 4 grid graph problems", 90, "practice", "Number of Islands, Max Area of Island, Rotting Oranges, Pacific Atlantic."),
      t("Topological sort + Union-Find", 60, "learn", "Kahn's algorithm; union by rank."),
      t("Solve 3 graph problems", 80, "practice", "Course Schedule I/II, Number of Connected Components."),
      t("Review + checkpoint", 50, "quiz", "Spaced re-solve then checkpoint."),
    ],
  }),
  mod("dsa", 5, {
    title: "Dynamic Programming", level: "Intermediate → Advanced", estimated_hours: 12,
    objective: "Turn a recursive brute force into memoised and tabulated DP.",
    first_principle: "Trade space for time + overlapping subproblems", zpd_scaffold: "Always: brute-force recursion → memo → table. Hints allowed for first 4 problems only.",
    key_concepts: ["State definition", "Recurrence", "Memoisation", "Tabulation", "1D vs 2D DP"],
    checkpoint: "Solve 'Coin Change' and 'Longest Common Subsequence' with explanation of state.",
    resources: [
      r("youtube", "freeCodeCamp — Dynamic Programming course", "https://www.youtube.com/@freecodecamp", "Frequently recommended DP intro on Reddit."),
      r("reddit", "r/leetcode — how to get good at DP threads", "https://www.reddit.com/r/leetcode/", "Common advice: always start from recursion."),
    ],
    tasks: [
      t("DP mental model: recursion → memo → table", 50, "learn", "Do Fibonacci and Climbing Stairs all three ways."),
      t("Solve 4 1D DP problems", 100, "practice", "House Robber, Min Cost Climbing Stairs, Decode Ways, Coin Change."),
      t("Solve 3 2D DP problems", 100, "practice", "Unique Paths, LCS, Edit Distance (stretch)."),
      t("Review: re-derive 3 recurrences from scratch", 45, "review", "Write state + transition before coding."),
      t("Checkpoint quiz", 45, "quiz", "Timed."),
    ],
  }),
  mod("dsa", 6, {
    title: "Mock Interviews & Mixed Practice", level: "Interview-ready", estimated_hours: 7,
    objective: "Solve unseen mediums in 30 min while explaining your thinking aloud.",
    first_principle: "Retrieval under pressure", zpd_scaffold: "Peer mocks with feedback, then solo timed sets.",
    key_concepts: ["Communication", "Clarifying questions", "Testing out loud", "Pattern recognition"],
    checkpoint: "Pass 2 mock interviews (self-graded rubric ≥ 3/4).",
    resources: [
      r("article", "Tech Interview Handbook — coding interview cheatsheet", "https://www.techinterviewhandbook.org/coding-interview-cheatsheet/", "Checklist for during the interview."),
      r("reddit", "r/cscareerquestions", "https://www.reddit.com/r/cscareerquestions/", "Recent interview experiences."),
    ],
    tasks: [
      t("Mixed timed set #1 (3 mediums)", 90, "practice", "30 min each, talk aloud and record yourself."),
      t("Mock interview with a peer", 60, "project", "Use the cheatsheet rubric."),
      t("Mixed timed set #2", 90, "practice", "Focus on weakest pattern."),
      t("Final mock + retrospective", 75, "quiz", "Write a one-page retro of what to keep practising."),
    ],
  }),
];

// ---------------------------------------------------------------- Spanish

const spanishRoadmap: Roadmap = {
  title: "Conversational Spanish: A2 → B1",
  summary:
    "Comprehension-first plan built on comprehensible input (Dreaming Spanish, Easy Spanish) with structured grammar via Language Transfer and daily Anki, reaching confident 20-minute conversations with a tutor in 8 weeks.",
  first_principles: [
    { principle: "You acquire language from understood input", explanation: "Comprehension precedes production; input slightly above your level (i+1) drives acquisition." },
    { principle: "Memory decays unless retrieved", explanation: "Spaced repetition schedules reviews right before you forget." },
    { principle: "Speaking is a separate motor skill", explanation: "It must be practised out loud with feedback, not just studied." },
  ],
  zpd: {
    can_do_alone: ["Introduce yourself", "Understand slow, simple speech", "Present tense"],
    can_do_with_guidance: ["Past tenses (pretérito/imperfecto)", "Following native-speed podcasts with transcripts"],
    out_of_reach_now: ["Subjunctive in conversation", "Unscripted native-speed TV"],
    strategy: "Daily input at 'intermediate' level on Dreaming Spanish, grammar in small doses, weekly tutor sessions that increase in length.",
  },
  diagram_mermaid: `flowchart TD
  P1["Comprehensible input"] --> M1["1 Listening base"]
  P2["Spaced retrieval"] --> M2["2 Core grammar and vocab"]
  M1 --> M2
  M2 --> M3["3 Past tenses in context"]
  P3["Speaking is a motor skill"] --> M4
  M3 --> M4["4 Conversation practice"]`,
  modules: [],
  verification: {
    confidence_score: 82,
    consensus_notes: "r/Spanish and r/languagelearning broadly endorse comprehensible input + spaced repetition; disagreement mainly on how early to start speaking — plan compromises with weekly tutor sessions from week 3.",
    changes_made: ["Added tutor sessions from week 3 instead of week 6.", "Cut a paid course in favour of free Language Transfer."],
    open_risks: ["B1 speaking in 8 weeks depends on consistent daily input."],
  },
};
spanishRoadmap.modules = [
  mod("es", 0, {
    title: "Listening Base", level: "A2", estimated_hours: 6,
    objective: "Understand 'intermediate' Dreaming Spanish videos without subtitles.",
    first_principle: "Comprehensible input", zpd_scaffold: "Start with transcripts, remove them by day 5.",
    key_concepts: ["Comprehensible input", "Active vs passive listening"],
    checkpoint: "Summarise a 15-min video in Spanish (spoken, 2 min).",
    resources: [
      r("youtube", "Dreaming Spanish", "https://www.youtube.com/@DreamingSpanish", "Most recommended input source on r/Spanish."),
      r("youtube", "Easy Spanish — street interviews", "https://www.youtube.com/@EasySpanish", "Real accents with dual subtitles."),
    ],
    tasks: [
      t("Input: 3 intermediate videos + notes", 45, "learn", "Write 10 new words."),
      t("Input: street interviews with transcript", 40, "learn", "Shadow 5 sentences out loud."),
      t("Set up Anki deck and add 50 cards", 35, "practice", "Sentence cards, not single words."),
      t("Input without subtitles", 45, "practice", "Two videos; note what you missed."),
      t("Checkpoint: spoken summary", 30, "quiz", "Record yourself."),
    ],
  }),
  mod("es", 1, {
    title: "Core Grammar & Vocabulary", level: "A2 → A2+", estimated_hours: 7,
    objective: "Use ser/estar, por/para and object pronouns correctly in speech.",
    first_principle: "Spaced retrieval", zpd_scaffold: "Language Transfer audio guides you to build sentences yourself.",
    key_concepts: ["Ser vs estar", "Por vs para", "Object pronouns", "Reflexive verbs"],
    checkpoint: "Translate 20 sentences aloud with ≥ 85% accuracy.",
    resources: [
      r("course", "Language Transfer — Complete Spanish (free)", "https://www.languagetransfer.org/", "Thinking-method course loved on r/languagelearning."),
      r("docs", "SpanishDict grammar guides", "https://www.spanishdict.com/", "Clear grammar references with examples."),
      r("other", "Anki", "https://apps.ankiweb.net/", "Spaced repetition flashcards."),
    ],
    tasks: [
      t("Language Transfer lessons 1–10", 50, "learn", "Pause and answer out loud."),
      t("Ser vs estar drills", 35, "practice", "30 sentences."),
      t("Language Transfer lessons 11–20", 50, "learn", ""),
      t("Por vs para + pronouns drills", 40, "practice", ""),
      t("Review: Anki + re-listen", 30, "review", ""),
      t("Checkpoint translation test", 30, "quiz", ""),
    ],
  }),
  mod("es", 2, {
    title: "Past Tenses in Context", level: "A2+ → B1", estimated_hours: 6,
    objective: "Tell a story in the past mixing pretérito and imperfecto.",
    first_principle: "Comprehensible input", zpd_scaffold: "Story-based input → guided retelling → free retelling.",
    key_concepts: ["Pretérito", "Imperfecto", "Narrative connectors"],
    checkpoint: "Tell a 3-minute personal story in the past to a tutor.",
    resources: [r("reddit", "r/Spanish — preterite vs imperfect explanations", "https://www.reddit.com/r/Spanish/", "Many native-speaker explanations.")],
    tasks: [
      t("Learn pretérito vs imperfecto", 40, "learn", "Make a decision flowchart."),
      t("Listen to 3 story videos and retell", 50, "practice", ""),
      t("Write and record a past-tense story", 45, "project", ""),
      t("Review + checkpoint", 35, "quiz", ""),
    ],
  }),
  mod("es", 3, {
    title: "Conversation Practice", level: "B1", estimated_hours: 6,
    objective: "Hold a 20-minute conversation on everyday topics.",
    first_principle: "Speaking is a motor skill", zpd_scaffold: "Tutor sessions grow from 20 → 45 min; topic prep sheets fade out.",
    key_concepts: ["Fillers & repair strategies", "Asking follow-ups"],
    checkpoint: "20-minute unscripted conversation with tutor feedback ≥ B1.",
    resources: [r("course", "italki — community tutors", "https://www.italki.com/", "Affordable 1:1 speaking practice.")],
    tasks: [
      t("Tutor session #1 (20 min) + prep", 45, "practice", ""),
      t("Shadowing session", 30, "practice", ""),
      t("Tutor session #2 (30 min) + prep", 55, "practice", ""),
      t("Final assessment conversation", 50, "quiz", ""),
    ],
  }),
];

// ---------------------------------------------------------------- ML

const mlRoadmap: Roadmap = {
  title: "Machine Learning Foundations",
  summary:
    "From high-school maths to training and evaluating your own models. Derives each algorithm from linear algebra, probability and optimisation, then applies it with scikit-learn and Kaggle datasets.",
  first_principles: [
    { principle: "Learning = minimising a loss", explanation: "Every model picks parameters that make a measured error small." },
    { principle: "Gradients point uphill", explanation: "Gradient descent walks opposite the derivative; this powers almost all of modern ML." },
    { principle: "Generalisation, not memorisation", explanation: "A model is only useful on data it hasn't seen — hence train/validation/test splits." },
  ],
  zpd: {
    can_do_alone: ["Python & pandas basics", "High-school algebra"],
    can_do_with_guidance: ["Vectors, matrices, derivatives", "Reading model evaluation metrics"],
    out_of_reach_now: ["Deriving backprop for deep nets", "Research papers"],
    strategy: "Visual intuition first (3Blue1Brown, StatQuest), then implement from scratch in NumPy, then the library version.",
  },
  diagram_mermaid: `flowchart TD
  P1["Loss minimisation"] --> M2
  P2["Gradients"] --> M2
  M1["1 Maths intuition"] --> M2["2 Linear models from scratch"]
  M2 --> M3["3 Evaluation and generalisation"]
  P3["Generalisation"] --> M3
  M3 --> M4["4 Trees and ensembles"]
  M4 --> M5["5 Neural network basics"]`,
  modules: [],
  verification: {
    confidence_score: 85,
    consensus_notes: "r/learnmachinelearning consistently recommends Andrew Ng's specialisation + StatQuest + hands-on Kaggle; fast.ai suggested as top-down alternative.",
    changes_made: ["Added from-scratch NumPy implementation before scikit-learn.", "Moved neural nets to the end."],
    open_risks: ["Maths module may need extra time if calculus is rusty."],
  },
};
mlRoadmap.modules = [
  mod("ml", 0, {
    title: "Maths Intuition", level: "Beginner", estimated_hours: 6,
    objective: "Visualise vectors, matrices and derivatives well enough to read ML formulas.",
    first_principle: "Gradients point uphill", zpd_scaffold: "Animations first, then small NumPy exercises.",
    key_concepts: ["Vectors", "Dot product", "Matrix multiply", "Derivative", "Chain rule"],
    checkpoint: "Compute a gradient by hand and verify numerically in NumPy.",
    resources: [
      r("youtube", "3Blue1Brown — Essence of linear algebra & calculus", "https://www.youtube.com/@3blue1brown", "Best visual intuition, universally recommended."),
      r("book", "An Introduction to Statistical Learning (free)", "https://www.statlearning.com/", "Accessible theory with labs."),
    ],
    tasks: [
      t("Watch: Essence of Linear Algebra ch. 1–4", 60, "learn", ""),
      t("NumPy vector/matrix exercises", 45, "practice", ""),
      t("Watch: Essence of Calculus ch. 1–4", 60, "learn", ""),
      t("Numerical gradient checker", 45, "project", ""),
    ],
  }),
  mod("ml", 1, {
    title: "Linear Models from Scratch", level: "Beginner → Novice", estimated_hours: 7,
    objective: "Implement linear and logistic regression with gradient descent.",
    first_principle: "Learning = minimising a loss", zpd_scaffold: "Template notebook with blanks → full from-scratch implementation.",
    key_concepts: ["MSE", "Cross-entropy", "Gradient descent", "Learning rate"],
    checkpoint: "From-scratch logistic regression within 2% accuracy of scikit-learn.",
    resources: [
      r("course", "Machine Learning Specialization — Andrew Ng", "https://www.coursera.org/specializations/machine-learning-introduction", "The most recommended ML starting course."),
      r("youtube", "StatQuest — linear & logistic regression", "https://www.youtube.com/@statquest", "Clear, intuition-first explanations."),
    ],
    tasks: [
      t("Course: linear regression + gradient descent", 60, "learn", ""),
      t("Implement linear regression in NumPy", 70, "project", ""),
      t("Course: logistic regression", 50, "learn", ""),
      t("Implement logistic regression + compare to sklearn", 80, "project", ""),
      t("Checkpoint", 30, "quiz", ""),
    ],
  }),
  mod("ml", 2, {
    title: "Evaluation & Generalisation", level: "Novice", estimated_hours: 5,
    objective: "Detect over/underfitting and choose the right metric.",
    first_principle: "Generalisation, not memorisation", zpd_scaffold: "Guided Kaggle notebook → your own experiment.",
    key_concepts: ["Train/val/test", "Cross-validation", "Bias-variance", "Precision/recall", "Regularisation"],
    checkpoint: "Write a short report explaining a model's validation curve.",
    resources: [
      r("docs", "scikit-learn User Guide — model selection", "https://scikit-learn.org/stable/user_guide.html", "Canonical reference."),
      r("course", "Kaggle Learn — Intro to ML", "https://www.kaggle.com/learn", "Free hands-on micro-courses."),
    ],
    tasks: [
      t("Kaggle Intro to ML lessons", 60, "learn", ""),
      t("Cross-validation experiment", 60, "practice", ""),
      t("Regularisation sweep + plot", 50, "project", ""),
      t("Review + checkpoint report", 40, "quiz", ""),
    ],
  }),
  mod("ml", 3, {
    title: "Trees & Ensembles", level: "Novice → Intermediate", estimated_hours: 5,
    objective: "Train and tune random forests and gradient boosting.",
    first_principle: "Learning = minimising a loss", zpd_scaffold: "StatQuest intuition → sklearn → tuning on Kaggle data.",
    key_concepts: ["Decision trees", "Bagging", "Boosting", "Feature importance"],
    checkpoint: "Submit a Kaggle Titanic entry above 0.77.",
    resources: [r("reddit", "r/learnmachinelearning", "https://www.reddit.com/r/learnmachinelearning/", "Project feedback and study plans.")],
    tasks: [
      t("StatQuest: trees, random forests, boosting", 60, "learn", ""),
      t("Titanic: baseline + random forest", 70, "project", ""),
      t("Tune gradient boosting + submit", 70, "project", ""),
    ],
  }),
  mod("ml", 4, {
    title: "Neural Network Basics", level: "Intermediate", estimated_hours: 6,
    objective: "Build and train a small neural net, understanding backprop.",
    first_principle: "Gradients point uphill (chain rule)", zpd_scaffold: "Karpathy's micrograd walkthrough, coding along.",
    key_concepts: ["Neurons", "Backpropagation", "Activation functions", "Training loop"],
    checkpoint: "Train an MLP on MNIST to > 95% accuracy.",
    resources: [
      r("course", "Neural Networks: Zero to Hero — Andrej Karpathy", "https://karpathy.ai/zero-to-hero.html", "Build backprop from scratch."),
      r("course", "fast.ai — Practical Deep Learning", "https://course.fast.ai/", "Top-down practical alternative."),
    ],
    tasks: [
      t("micrograd lecture, code along", 90, "learn", ""),
      t("Build MLP for MNIST", 90, "project", ""),
      t("Final review & reflection", 40, "review", ""),
    ],
  }),
];

// ---------------------------------------------------------------- assemble

function demoGoal(g: Omit<Goal, "id" | "sessions" | "createdAt">, completeBefore: string, skip: string[] = []): Goal {
  const goal: Goal = { ...g, id: uid(), createdAt: g.startDate, sessions: [] };
  goal.sessions = buildSessions(goal, goal.startDate).map((s) => ({ ...s, done: s.date < completeBefore && !skip.includes(s.date) }));
  return goal;
}

export function createDemoState(): AppState {
  const t0 = today();
  const everyDay = [0, 1, 2, 3, 4, 5, 6];
  return {
    settings: { provider: "anthropic", model: "claude-opus-5-5", baseUrl: "", apiKeyLast4: "", webResearch: true },
    routines: [
      { id: uid(), title: "Sleep", start: "23:00", end: "07:00", days: everyDay, color: "#4b5563" },
      { id: uid(), title: "Breakfast", start: "07:30", end: "08:00", days: everyDay, color: "#8a6a55" },
      { id: uid(), title: "Work", start: "09:00", end: "17:30", days: [1, 2, 3, 4, 5], color: "#6a9bcc" },
      { id: uid(), title: "Gym", start: "18:00", end: "19:00", days: [1, 3, 5], color: "#7fb685" },
      { id: uid(), title: "Dinner", start: "20:30", end: "21:00", days: everyDay, color: "#8a6a55" },
    ],
    events: [
      { id: uid(), date: addDays(t0, 1), title: "Dentist", start: "17:45", end: "18:30" },
      { id: uid(), date: addDays(t0, 3), title: "Friend's birthday dinner", start: "19:30", end: "22:00" },
    ],
    goals: [
      demoGoal(
        {
          title: "Crack DSA for coding interviews", outcome: "Pass FAANG-style coding rounds", currentLevel: "Some exposure",
          known: "Python basics, solved ~20 LeetCode easies", targetLevel: "Job-ready", startDate: addDays(t0, -16), deadline: addDays(t0, 54),
          hoursPerDay: 1.5, days: everyDay, prefStart: "19:00", prefs: "Prefer video walkthroughs then practice", color: "#d97757", roadmap: dsaRoadmap,
        },
        t0,
        [addDays(t0, -2), addDays(t0, -1)], // two missed days → "behind" demo
      ),
      demoGoal(
        {
          title: "Conversational Spanish", outcome: "Chat comfortably on a trip to Mexico", currentLevel: "Beginner+",
          known: "Duolingo for 3 months, present tense", targetLevel: "Intermediate (B1)", startDate: addDays(t0, -9), deadline: addDays(t0, 47),
          hoursPerDay: 0.75, days: everyDay, prefStart: "07:00", prefs: "Comprehensible input, free resources", color: "#6a9bcc", roadmap: spanishRoadmap,
        },
        t0,
      ),
      demoGoal(
        {
          title: "Machine learning foundations", outcome: "Build and evaluate my own ML models", currentLevel: "Beginner",
          known: "Python, pandas", targetLevel: "Working knowledge", startDate: t0, deadline: addDays(t0, 60),
          hoursPerDay: 1, days: [0, 2, 4, 6], prefStart: "21:00", prefs: "Visual explanations, hands-on projects", color: "#7fb685", roadmap: mlRoadmap,
        },
        t0,
      ),
    ],
  };
}

/** Pick a demo roadmap for the simulated generator (P0 has no AI wired up). */
export function demoRoadmapFor(goalTitle: string): Roadmap {
  const s = goalTitle.toLowerCase();
  const base = /spanish|french|german|language|japanese|hindi/.test(s)
    ? spanishRoadmap
    : /machine|ml|ai|data science|neural/.test(s)
      ? mlRoadmap
      : dsaRoadmap;
  const prefix = uid();
  const copy: Roadmap = structuredClone(base);
  copy.title = goalTitle;
  copy.modules = copy.modules.map((m, i) => ({ ...m, id: `${prefix}m${i}`, tasks: m.tasks.map((x, j) => ({ ...x, id: `${prefix}m${i}t${j}` })) }));
  return copy;
}
