/**
 * Exercise library data.
 *
 * Primary images come from the public-domain free-exercise-db
 * (https://github.com/yuhonas/free-exercise-db) which hosts real per-exercise
 * demonstration photos. `dbId` is the dataset folder; `fallback` is a distinct
 * gym photo shown only if the primary image fails to load (so nothing breaks).
 */

export type Difficulty = "Beginner" | "Intermediate" | "Advanced";

export interface Exercise {
  id: string;
  name: string;
  category: string;
  muscle: string;
  difficulty: Difficulty;
  equipment: string;
  sets: string;
  reps: string;
  dbId: string;
  instructions: string[];
  mistakes: string[];
  tips: string[];
  fallback: string;
}

export const CATEGORIES = [
  "Chest",
  "Back",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Legs",
  "Abs & Core",
] as const;

const DB = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises";

/** Primary demonstration image (frame 0 or 1) from the public dataset. */
export function exerciseImage(ex: Exercise, frame: 0 | 1 = 0): string {
  return `${DB}/${ex.dbId}/${frame}.jpg`;
}

// Distinct fitness photos (Unsplash) used only as graceful fallbacks.
const F = [
  "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1532384748853-8f54a8f476e2?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1526506118085-60ce8714f8c5?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1599058917212-d750089bc07e?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1594737625785-a6cbdabd333c?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1540497077202-7c8a3999166f?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=800&q=80",
];
let _fi = 0;
const fb = () => F[_fi++ % F.length];

export const EXERCISES: Exercise[] = [
  // ---------------- Chest ----------------
  {
    id: "bench-press", name: "Bench Press", category: "Chest", muscle: "Chest, Triceps, Shoulders",
    difficulty: "Intermediate", equipment: "Barbell, Bench", sets: "4", reps: "8–12",
    dbId: "Barbell_Bench_Press_-_Medium_Grip",
    instructions: [
      "Lie flat on the bench with feet planted and eyes under the bar.",
      "Grip the bar slightly wider than shoulder width.",
      "Lower the bar to mid-chest with control, elbows ~45°.",
      "Press back up until arms are fully extended.",
    ],
    mistakes: ["Bouncing the bar off the chest", "Flaring elbows out to 90°", "Lifting hips off the bench"],
    tips: ["Keep shoulder blades retracted", "Use a spotter for heavy sets"], fallback: fb(),
  },
  {
    id: "incline-db-press", name: "Incline Dumbbell Press", category: "Chest", muscle: "Upper Chest",
    difficulty: "Intermediate", equipment: "Dumbbells, Incline Bench", sets: "3", reps: "10–12",
    dbId: "Incline_Dumbbell_Press",
    instructions: [
      "Set the bench to 30–45°.",
      "Start with dumbbells at shoulder level.",
      "Press up and slightly together at the top.",
      "Lower under control to the stretch position.",
    ],
    mistakes: ["Setting the bench too steep", "Clanking dumbbells at the top"],
    tips: ["Control the eccentric for 2 seconds", "Keep wrists stacked over elbows"], fallback: fb(),
  },
  {
    id: "cable-fly", name: "Cable Fly", category: "Chest", muscle: "Chest (inner)",
    difficulty: "Beginner", equipment: "Cable Machine", sets: "3", reps: "12–15",
    dbId: "Cable_Crossover",
    instructions: [
      "Set pulleys high and grab both handles.",
      "Step forward with a slight forward lean.",
      "Bring hands together in a wide arc.",
      "Return slowly to the stretched position.",
    ],
    mistakes: ["Turning it into a press", "Using too much weight and shrugging"],
    tips: ["Keep a soft bend in the elbows", "Squeeze at the midline"], fallback: fb(),
  },
  {
    id: "pushups", name: "Push-ups", category: "Chest", muscle: "Chest, Triceps, Core",
    difficulty: "Beginner", equipment: "Bodyweight", sets: "3", reps: "15–20",
    dbId: "Pushups",
    instructions: [
      "Start in a plank, hands just wider than shoulders.",
      "Keep body in a straight line.",
      "Lower until chest nearly touches the floor.",
      "Press back up fully.",
    ],
    mistakes: ["Sagging hips", "Half reps", "Flaring elbows"],
    tips: ["Brace your core throughout", "Elevate hands to scale down"], fallback: fb(),
  },
  {
    id: "chest-dips", name: "Chest Dips", category: "Chest", muscle: "Lower Chest, Triceps",
    difficulty: "Advanced", equipment: "Dip Bars", sets: "3", reps: "8–12",
    dbId: "Dips_-_Chest_Version",
    instructions: [
      "Grip parallel bars and support your weight.",
      "Lean the torso forward ~30°.",
      "Lower until you feel a chest stretch.",
      "Press back up without locking harshly.",
    ],
    mistakes: ["Going too deep too soon", "Staying fully upright (shifts to triceps)"],
    tips: ["Add a band for assistance", "Control the descent"], fallback: fb(),
  },

  // ---------------- Back ----------------
  {
    id: "lat-pulldown", name: "Lat Pulldown", category: "Back", muscle: "Lats",
    difficulty: "Beginner", equipment: "Cable Machine", sets: "4", reps: "10–12",
    dbId: "Wide-Grip_Lat_Pulldown",
    instructions: [
      "Grip the bar wider than shoulders.",
      "Sit with thighs under the pads.",
      "Pull the bar to your upper chest, driving elbows down.",
      "Return under control to a full stretch.",
    ],
    mistakes: ["Leaning back excessively", "Pulling behind the neck"],
    tips: ["Lead with the elbows", "Pause briefly at the bottom"], fallback: fb(),
  },
  {
    id: "pullups", name: "Pull-ups", category: "Back", muscle: "Lats, Biceps",
    difficulty: "Advanced", equipment: "Pull-up Bar", sets: "3", reps: "6–10",
    dbId: "Pullups",
    instructions: [
      "Hang from the bar with an overhand grip.",
      "Pull until your chin clears the bar.",
      "Lower all the way down with control.",
    ],
    mistakes: ["Kipping/swinging", "Partial range"],
    tips: ["Use a band to assist", "Think about pulling elbows to hips"], fallback: fb(),
  },
  {
    id: "seated-row", name: "Seated Cable Row", category: "Back", muscle: "Mid Back",
    difficulty: "Beginner", equipment: "Cable Machine", sets: "4", reps: "10–12",
    dbId: "Seated_Cable_Rows",
    instructions: [
      "Sit tall with a slight knee bend.",
      "Grip the handle and keep your back straight.",
      "Pull the handle to your navel, squeezing the shoulder blades.",
      "Extend the arms under control.",
    ],
    mistakes: ["Rounding the lower back", "Using momentum from the torso"],
    tips: ["Keep the chest proud", "Pause at the squeeze"], fallback: fb(),
  },
  {
    id: "barbell-row", name: "Barbell Row", category: "Back", muscle: "Lats, Rhomboids",
    difficulty: "Intermediate", equipment: "Barbell", sets: "4", reps: "8–10",
    dbId: "Bent_Over_Barbell_Row",
    instructions: [
      "Hinge at the hips with a flat back ~45°.",
      "Grip the bar shoulder-width.",
      "Row the bar to your lower ribs.",
      "Lower under control.",
    ],
    mistakes: ["Standing too upright", "Jerking with the lower back"],
    tips: ["Brace hard", "Keep the bar close to the body"], fallback: fb(),
  },
  {
    id: "deadlift", name: "Deadlift", category: "Back", muscle: "Posterior Chain",
    difficulty: "Advanced", equipment: "Barbell", sets: "4", reps: "5–6",
    dbId: "Barbell_Deadlift",
    instructions: [
      "Stand with mid-foot under the bar.",
      "Hinge and grip just outside the knees.",
      "Brace, then drive through the floor standing tall.",
      "Return the bar along the legs with a flat back.",
    ],
    mistakes: ["Rounding the back", "Jerking the bar off the floor", "Hyperextending at the top"],
    tips: ["Keep the bar close", "Engage lats before you pull"], fallback: fb(),
  },

  // ---------------- Shoulders ----------------
  {
    id: "shoulder-press", name: "Shoulder Press", category: "Shoulders", muscle: "Deltoids",
    difficulty: "Intermediate", equipment: "Dumbbells", sets: "4", reps: "8–12",
    dbId: "Dumbbell_Shoulder_Press",
    instructions: [
      "Sit tall with dumbbells at shoulder height.",
      "Press overhead until arms are extended.",
      "Lower under control to ear level.",
    ],
    mistakes: ["Arching the lower back", "Partial lockout"],
    tips: ["Brace the core", "Keep wrists stacked"], fallback: fb(),
  },
  {
    id: "lateral-raise", name: "Lateral Raises", category: "Shoulders", muscle: "Side Delts",
    difficulty: "Beginner", equipment: "Dumbbells", sets: "3", reps: "12–15",
    dbId: "Side_Lateral_Raise",
    instructions: [
      "Hold dumbbells at your sides.",
      "Raise out to shoulder height with soft elbows.",
      "Lower slowly.",
    ],
    mistakes: ["Swinging/using momentum", "Shrugging the traps"],
    tips: ["Lead with the elbows", "Use lighter weight, strict form"], fallback: fb(),
  },
  {
    id: "front-raise", name: "Front Raises", category: "Shoulders", muscle: "Front Delts",
    difficulty: "Beginner", equipment: "Dumbbells", sets: "3", reps: "12–15",
    dbId: "Front_Dumbbell_Raise",
    instructions: [
      "Hold dumbbells in front of the thighs.",
      "Raise one or both to shoulder height.",
      "Lower under control.",
    ],
    mistakes: ["Going above shoulder height", "Leaning back"],
    tips: ["Keep a slight elbow bend", "Avoid momentum"], fallback: fb(),
  },
  {
    id: "reverse-fly", name: "Reverse Fly", category: "Shoulders", muscle: "Rear Delts",
    difficulty: "Beginner", equipment: "Dumbbells", sets: "3", reps: "12–15",
    dbId: "Reverse_Flyes",
    instructions: [
      "Hinge forward with a flat back.",
      "Raise dumbbells out to the sides.",
      "Squeeze the rear delts, then lower.",
    ],
    mistakes: ["Using the traps", "Too heavy, swinging"],
    tips: ["Lead with pinkies up", "Keep the neck neutral"], fallback: fb(),
  },

  // ---------------- Biceps ----------------
  {
    id: "db-curl", name: "Dumbbell Curls", category: "Biceps", muscle: "Biceps",
    difficulty: "Beginner", equipment: "Dumbbells", sets: "3", reps: "10–12",
    dbId: "Dumbbell_Bicep_Curl",
    instructions: [
      "Stand with dumbbells at your sides, palms forward.",
      "Curl up while keeping elbows pinned.",
      "Lower slowly to full extension.",
    ],
    mistakes: ["Swinging the torso", "Moving the elbows forward"],
    tips: ["Squeeze at the top", "Control the lowering phase"], fallback: fb(),
  },
  {
    id: "hammer-curl", name: "Hammer Curls", category: "Biceps", muscle: "Biceps, Brachialis",
    difficulty: "Beginner", equipment: "Dumbbells", sets: "3", reps: "10–12",
    dbId: "Hammer_Curls",
    instructions: [
      "Hold dumbbells with a neutral (hammer) grip.",
      "Curl up keeping the thumbs up.",
      "Lower with control.",
    ],
    mistakes: ["Rotating the wrist", "Using momentum"],
    tips: ["Keep elbows tight", "Great for forearm/brachialis"], fallback: fb(),
  },
  {
    id: "barbell-curl", name: "Barbell Curls", category: "Biceps", muscle: "Biceps",
    difficulty: "Beginner", equipment: "Barbell", sets: "3", reps: "8–12",
    dbId: "Barbell_Curl",
    instructions: [
      "Grip the bar shoulder-width, palms up.",
      "Curl up keeping elbows fixed.",
      "Lower slowly to full extension.",
    ],
    mistakes: ["Leaning back", "Half reps"],
    tips: ["Keep a tight core", "Don't rest at the bottom"], fallback: fb(),
  },

  // ---------------- Triceps ----------------
  {
    id: "triceps-pushdown", name: "Triceps Pushdown", category: "Triceps", muscle: "Triceps",
    difficulty: "Beginner", equipment: "Cable Machine", sets: "3", reps: "12–15",
    dbId: "Triceps_Pushdown",
    instructions: [
      "Grip the bar/rope at a high pulley.",
      "Keep elbows pinned to your sides.",
      "Extend down fully, then return to ~90°.",
    ],
    mistakes: ["Elbows drifting forward", "Using the shoulders"],
    tips: ["Lock out and squeeze", "Keep the torso still"], fallback: fb(),
  },
  {
    id: "skull-crushers", name: "Skull Crushers", category: "Triceps", muscle: "Triceps (long head)",
    difficulty: "Intermediate", equipment: "EZ Bar", sets: "3", reps: "10–12",
    dbId: "Lying_Triceps_Press",
    instructions: [
      "Lie on a bench holding the bar over your chest.",
      "Bend the elbows to lower the bar toward your forehead.",
      "Extend back up without moving the upper arms.",
    ],
    mistakes: ["Flaring the elbows", "Moving the shoulders"],
    tips: ["Keep upper arms vertical", "Control the descent"], fallback: fb(),
  },
  {
    id: "overhead-extension", name: "Overhead Extension", category: "Triceps", muscle: "Triceps",
    difficulty: "Beginner", equipment: "Dumbbell", sets: "3", reps: "12–15",
    dbId: "Standing_Dumbbell_Triceps_Extension",
    instructions: [
      "Hold one dumbbell overhead with both hands.",
      "Lower behind the head by bending the elbows.",
      "Extend back overhead.",
    ],
    mistakes: ["Flaring elbows wide", "Arching the back"],
    tips: ["Keep elbows close to the head", "Full stretch at the bottom"], fallback: fb(),
  },

  // ---------------- Legs ----------------
  {
    id: "squats", name: "Squats", category: "Legs", muscle: "Quads, Glutes",
    difficulty: "Intermediate", equipment: "Barbell", sets: "4", reps: "8–10",
    dbId: "Barbell_Squat",
    instructions: [
      "Bar on upper back, feet shoulder-width.",
      "Brace and sit down and back.",
      "Descend to at least parallel.",
      "Drive up through mid-foot.",
    ],
    mistakes: ["Knees caving in", "Heels lifting", "Rounding the back"],
    tips: ["Keep the chest up", "Push the knees out"], fallback: fb(),
  },
  {
    id: "leg-press", name: "Leg Press", category: "Legs", muscle: "Quads, Glutes",
    difficulty: "Beginner", equipment: "Leg Press Machine", sets: "4", reps: "10–12",
    dbId: "Leg_Press",
    instructions: [
      "Sit with feet shoulder-width on the platform.",
      "Lower until knees reach ~90°.",
      "Press back without locking the knees hard.",
    ],
    mistakes: ["Lifting hips off the seat", "Locking knees aggressively"],
    tips: ["Keep knees tracking over toes", "Control the negative"], fallback: fb(),
  },
  {
    id: "lunges", name: "Lunges", category: "Legs", muscle: "Quads, Glutes",
    difficulty: "Beginner", equipment: "Dumbbells", sets: "3", reps: "10–12 / leg",
    dbId: "Dumbbell_Lunges",
    instructions: [
      "Hold dumbbells at your sides.",
      "Step forward and lower the back knee toward the floor.",
      "Drive back to standing.",
    ],
    mistakes: ["Front knee past the toes excessively", "Leaning too far forward"],
    tips: ["Keep torso upright", "Step far enough forward"], fallback: fb(),
  },
  {
    id: "leg-extension", name: "Leg Extensions", category: "Legs", muscle: "Quads",
    difficulty: "Beginner", equipment: "Machine", sets: "3", reps: "12–15",
    dbId: "Leg_Extensions",
    instructions: [
      "Sit with shins behind the pad.",
      "Extend the knees fully.",
      "Lower under control.",
    ],
    mistakes: ["Swinging the weight", "Slamming the stack"],
    tips: ["Pause at the top", "Keep a steady tempo"], fallback: fb(),
  },
  {
    id: "leg-curl", name: "Leg Curls", category: "Legs", muscle: "Hamstrings",
    difficulty: "Beginner", equipment: "Machine", sets: "3", reps: "12–15",
    dbId: "Lying_Leg_Curls",
    instructions: [
      "Lie face down with the pad on your lower calves.",
      "Curl your heels toward your glutes.",
      "Lower slowly.",
    ],
    mistakes: ["Lifting the hips", "Using momentum"],
    tips: ["Keep hips pinned", "Squeeze the hamstrings"], fallback: fb(),
  },
  {
    id: "calf-raises", name: "Calf Raises", category: "Legs", muscle: "Calves",
    difficulty: "Beginner", equipment: "Machine / Bodyweight", sets: "4", reps: "15–20",
    dbId: "Standing_Calf_Raises",
    instructions: [
      "Stand with the balls of your feet on a platform.",
      "Rise onto your toes as high as possible.",
      "Lower into a deep stretch.",
    ],
    mistakes: ["Bouncing", "Short range of motion"],
    tips: ["Pause at the top", "Full stretch at the bottom"], fallback: fb(),
  },

  // ---------------- Abs & Core ----------------
  {
    id: "crunches", name: "Crunches", category: "Abs & Core", muscle: "Abs",
    difficulty: "Beginner", equipment: "Bodyweight", sets: "3", reps: "15–20",
    dbId: "Crunches",
    instructions: [
      "Lie on your back, knees bent.",
      "Curl your shoulders off the floor.",
      "Lower under control.",
    ],
    mistakes: ["Pulling on the neck", "Using momentum"],
    tips: ["Exhale as you crunch", "Keep the lower back down"], fallback: fb(),
  },
  {
    id: "leg-raises", name: "Leg Raises", category: "Abs & Core", muscle: "Lower Abs",
    difficulty: "Intermediate", equipment: "Bodyweight", sets: "3", reps: "12–15",
    dbId: "Flat_Bench_Lying_Leg_Raise",
    instructions: [
      "Lie flat, hands under your hips.",
      "Raise straight legs to vertical.",
      "Lower slowly without touching the floor.",
    ],
    mistakes: ["Arching the lower back", "Dropping the legs fast"],
    tips: ["Press the lower back into the floor", "Go slow on the way down"], fallback: fb(),
  },
  {
    id: "plank", name: "Plank", category: "Abs & Core", muscle: "Core",
    difficulty: "Beginner", equipment: "Bodyweight", sets: "3", reps: "30–60 sec",
    dbId: "Plank",
    instructions: [
      "Rest on forearms and toes.",
      "Keep the body in a straight line.",
      "Brace the core and hold.",
    ],
    mistakes: ["Sagging hips", "Raising the hips too high"],
    tips: ["Squeeze glutes and abs", "Breathe steadily"], fallback: fb(),
  },
  {
    id: "russian-twists", name: "Russian Twists", category: "Abs & Core", muscle: "Obliques",
    difficulty: "Intermediate", equipment: "Weight Plate", sets: "3", reps: "20 / side",
    dbId: "Russian_Twist",
    instructions: [
      "Sit with knees bent, lean back slightly.",
      "Hold a weight and rotate side to side.",
      "Keep the core braced throughout.",
    ],
    mistakes: ["Moving only the arms", "Rounding the back"],
    tips: ["Rotate from the torso", "Lift the feet to progress"], fallback: fb(),
  },
];

export interface WorkoutPlan {
  name: string;
  level: Difficulty;
  blurb: string;
  schedule: string;
  focus: string[];
  image: string;
}

export const WORKOUT_PLANS: WorkoutPlan[] = [
  {
    name: "Beginner Foundation",
    level: "Beginner",
    blurb: "Build a base of strength and movement quality with full-body sessions.",
    schedule: "3 days / week",
    focus: ["Full-body strength", "Technique", "Core stability"],
    image: "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=900&q=80",
  },
  {
    name: "Muscle Builder",
    level: "Intermediate",
    blurb: "A push/pull/legs split engineered for hypertrophy and lean mass.",
    schedule: "5 days / week",
    focus: ["Hypertrophy", "Progressive overload", "Push / Pull / Legs"],
    image: "https://images.unsplash.com/photo-1532384748853-8f54a8f476e2?auto=format&fit=crop&w=900&q=80",
  },
  {
    name: "Elite Strength",
    level: "Advanced",
    blurb: "Heavy compound focus for maximal strength and power development.",
    schedule: "4–5 days / week",
    focus: ["Squat / Bench / Deadlift", "Low reps, heavy loads", "Accessory work"],
    image: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=900&q=80",
  },
];
