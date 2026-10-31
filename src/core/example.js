// A fully answered example store, used by "Try it with an example store" and by the tests.

import { blankStore, newAisle, setNb, syncDerived } from "./model.js";

export function exampleStore() {
  const S = blankStore();
  Object.assign(S, { name: "Maple Street Market", address: "123 Main St, Springfield", stage: "list", reached: 4 });
  const mk = (no, items, orient, flow = null) => Object.assign(newAisle(), { no, items, orient, flow });

  const produce = mk("", ["produce", "bananas", "apples", "tomatoes", "salad greens", "herbs"], "v");
  const A = [
    mk("1", ["cereal", "oatmeal", "pancake mix", "maple syrup"], "v", "cf"),
    mk("2", ["baking", "flour", "sugar", "spices"], "v", "fc"),
    mk("3", ["pasta", "canned goods", "rice", "soup"], "v", "cf"),
    mk("4", ["condiments", "peanut butter", "jam", "olive oil"], "v", "fc"),
    mk("5", ["snacks", "chips", "crackers", "cookies"], "v", "cf"),
    mk("6", ["beverages", "water", "soda", "coffee"], "v", "fc"),
    mk("7", ["frozen", "ice cream", "frozen pizza"], "v", "cf"),
    mk("8", ["household", "paper towels", "laundry detergent"], "v", "fc"),
  ];
  const bakery = mk("", ["bakery", "bread", "bagels", "cakes"], "h");
  const deli = mk("", ["deli", "sliced meats", "prepared foods"], "h");
  const meat = mk("", ["meat & seafood", "chicken", "salmon"], "h");
  const dairy = mk("", ["dairy", "milk", "eggs", "yogurt"], "v");

  S.aisles = [produce, ...A, bakery, deli, meat, dairy];
  S.count = S.aisles.length;

  setNb(S, produce, "w", "wall");
  setNb(S, produce, "e", A[0].id);
  A.forEach((a, i) => A[i + 1] && setNb(S, a, "e", A[i + 1].id));
  setNb(S, A[1], "n", bakery.id);
  setNb(S, A[4], "n", deli.id);
  setNb(S, A[7], "n", meat.id);
  [bakery, deli, meat].forEach((x) => setNb(S, x, "n", "wall"));
  setNb(S, A[7], "e", dairy.id);
  setNb(S, dairy, "e", "wall");
  setNb(S, A[3], "s", "checkout");
  setNb(S, A[7], "se", "entrance");

  S.aisles.forEach(syncDerived);
  return S;
}
