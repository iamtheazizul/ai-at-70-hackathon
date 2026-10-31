// Shared constants. One map cell = 2 ft.

export const STORAGE_KEY = "aisle-mapper-v2";
export const FT_PER_CELL = 2;
export const DEFAULT_W = 48; // floor size in cells when nothing else is known
export const DEFAULT_H = 32;
export const GAP = 3; // walkway between neighbouring aisles, in cells (6 ft)

export const DEPTS = {
  Produce: "#3E8E4F", Bakery: "#B9782E", "Meat & Seafood": "#B1473D", Deli: "#C25D7A",
  Dairy: "#3C7DB8", Frozen: "#3F9FAF", Pantry: "#7A6A3A", Beverages: "#6A58B0",
  Snacks: "#D0832A", Household: "#5B6A73", "Health & Beauty": "#9A4F9C", Other: "#6F7A72",
};

// Keywords used to guess an aisle's department from its categories.
export const KEYWORDS = {
  Produce: ["produce", "fruit", "vegetable", "veggie", "apple", "banana", "lettuce", "salad", "herb", "potato", "onion", "avocado", "tomato"],
  Bakery: ["bakery", "bread", "bagel", "cake", "pastry", "muffin", "croissant", "donut"],
  "Meat & Seafood": ["meat", "seafood", "chicken", "beef", "pork", "fish", "salmon", "shrimp", "butcher"],
  Deli: ["deli", "prepared", "sandwich", "rotisserie", "hot food"],
  Dairy: ["dairy", "milk", "egg", "yogurt", "butter", "cheese", "cream"],
  Frozen: ["frozen", "ice cream", "ice"],
  Beverages: ["beverage", "drink", "soda", "water", "juice", "coffee", "tea", "beer", "wine"],
  Snacks: ["snack", "chip", "cookie", "candy", "cracker", "popcorn", "nut"],
  Household: ["household", "cleaning", "paper", "laundry", "detergent", "pet", "trash", "dish soap"],
  "Health & Beauty": ["health", "beauty", "pharmacy", "vitamin", "shampoo", "toothpaste", "medicine", "baby"],
  Pantry: ["cereal", "pasta", "canned", "baking", "spice", "sauce", "rice", "condiment", "soup", "oil", "flour", "breakfast", "peanut butter", "jam", "international"],
};

// The 8 points around an aisle. n = back of the store, s = entrance side.
export const PTS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export const OPP = { n: "s", s: "n", e: "w", w: "e", ne: "sw", sw: "ne", nw: "se", se: "nw" };
export const PT_NAME = { nw: "Back left", n: "Back", ne: "Back right", e: "Right side", se: "Front right", s: "Front", sw: "Front left", w: "Left side" };
export const SPECIAL = { wall: "Store wall", entrance: "Entrance", checkout: "Checkout", open: "Open floor" };

export const FLOWS = {
  cf: ["Closest → furthest", "Starts near you, runs to the back"],
  fc: ["Furthest → closest", "Starts at the back, runs toward you"],
  lr: ["Left → right", "Starts on your left"],
  rl: ["Right → left", "Starts on your right"],
};

export const STAGES = [["address", "Store"], ["count", "How many"], ["list", "Aisles"], ["nb", "Neighbors"], ["map", "Map"]];
