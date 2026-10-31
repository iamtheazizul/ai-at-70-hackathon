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
  cf: ["Closest → furthest", "Walk from the entrance side to the back"],
  fc: ["Furthest → closest", "Walk from the back toward the entrance"],
  lr: ["Left → right", "Walk from the left wall to the right wall"],
  rl: ["Right → left", "Walk from the right wall to the left wall"],
};
// Flows that fit each orientation (v = vertical, h = horizontal). The first is the default.
export const FLOWS_FOR = { v: ["cf", "fc"], h: ["lr", "rl"] };
export const REVERSE_FLOW = { cf: "fc", fc: "cf", lr: "rl", rl: "lr" };

// A coded aisle is a walkway with a shelf strip on each side.
// While walking in the flow direction, which physical shelf is on your left / right?
// (north = back of store, south = entrance side, west = left wall, east = right wall)
export const SIDE_TO_WALL = {
  cf: { left: "west", right: "east" },
  fc: { left: "east", right: "west" },
  lr: { left: "north", right: "south" },
  rl: { left: "south", right: "north" },
};
export const SHELF_DEPTH = 1; // cells (2 ft) per shelf strip
export const M_PER_CELL = 0.6096; // 2 ft in metres, for the database

export const STAGES = [["address", "Store"], ["count", "How many"], ["list", "Aisles"], ["nb", "Neighbors"], ["map", "Map"]];
