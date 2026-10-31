// The one place the app picks where stores are kept.
// Today: the browser (localRepo). Later: swap in the database repository here and nothing else changes.

import { localRepo } from "./localRepo.js";

export const repo = localRepo;
