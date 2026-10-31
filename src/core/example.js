// A fully answered example store, used by "Try it with an example store" and by the tests.

import { blankStore, newAisle, setNb, syncDerived } from "./model.js";

export const EXAMPLE_ID = "example-maple-street";

export function exampleStore() {
  const S = blankStore();
  Object.assign(S, { id: EXAMPLE_ID, name: "Maple Street Market", address: "123 Main St, Springfield", stage: "list", reached: 4 });

  // coded aisle: left/right shelves listed in the order you pass them walking in the flow direction
  const aisle = (no, flow, left, right) => Object.assign(newAisle(), { no, orient: "v", flow, left, right });
  // section: one block, categories in items
  const section = (items, orient) => Object.assign(newAisle(), { items, orient });

  const produce = section(["produce", "bananas", "apples", "tomatoes", "salad greens", "herbs"], "v");
  const A = [
    aisle("1", "cf", ["cereal", "oatmeal"], ["pancake mix", "maple syrup"]),
    aisle("2", "fc", ["flour", "sugar"], ["spices", "baking soda"]),
    aisle("3", "cf", ["pasta", "pasta sauce", "rice"], ["canned beans", "soup"]),
    aisle("4", "fc", ["condiments", "peanut butter"], ["jam", "olive oil", "honey"]),
    aisle("5", "cf", ["chips", "popcorn"], ["crackers", "cookies", "candy"]),
    aisle("6", "fc", ["water", "soda"], ["coffee", "tea", "juice"]),
    aisle("7", "cf", ["ice cream", "frozen pizza"], ["frozen vegetables", "waffles"]),
    aisle("8", "fc", ["paper towels", "trash bags"], ["laundry detergent", "dish soap"]),
  ];
  const bakery = section(["bakery", "bread", "bagels", "cakes"], "h");
  const deli = section(["deli", "sliced meats", "prepared foods"], "h");
  const meat = section(["meat & seafood", "chicken", "salmon"], "h");
  const dairy = section(["dairy", "milk", "eggs", "yogurt", "butter"], "v");

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
