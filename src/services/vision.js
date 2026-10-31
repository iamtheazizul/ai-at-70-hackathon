// Photo → aisle categories.
//
// PLACEHOLDER — connect a vision model here.
// Receives the File objects a contributor took or uploaded for one aisle.
// Resolve to an array of category strings, e.g. ["cereal", "oatmeal", "granola"],
// or null while no model is connected (the UI then explains that to the contributor).

export async function suggestCategoriesFromPhotos(files) {
  // Example shape once connected:
  //   const body = new FormData();
  //   files.forEach((f) => body.append("photos", f));
  //   const res = await fetch("/api/aisle-categories", { method: "POST", body });
  //   return (await res.json()).categories;
  return null;
}
