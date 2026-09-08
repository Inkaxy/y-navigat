// EKTE kandidater fra matvaretabellen_foods (hentet fra basen 8. sep 2026).
// Navnene skal ikke «ryddes» — testene er bare verdt noe så lenge de speiler
// hvordan Matvaretabellen faktisk skriver navnene.

import type { FoodCandidate } from "@/ravarer/lib/foodSuggestions";

export const MATVARETABELLEN_FIXTURE: FoodCandidate[] = [
  // Mel
  { food_id: "mel-1", food_name: "Hvetemel, siktet", food_group_name: "Mel" },
  { food_id: "mel-2", food_name: "Hvetemel, økologisk", food_group_name: "Mel" },
  // Basen har ÉN post for begge malingsgradene, med skråstrek i navnet.
  { food_id: "mel-3", food_name: "Hvetemel, sammalt, fint/grovt", food_group_name: "Mel" },
  { food_id: "mel-4", food_name: "Potetmel, potetstivelse", food_group_name: "Mel", search_keywords: ["potetstivelse"] },

  // Sukker og honning
  { food_id: "suk-1", food_name: "Sukker, hvitt", food_group_name: "Sukker og honning" },
  { food_id: "suk-2", food_name: "Sukker, brunt", food_group_name: "Sukker og honning" },
  { food_id: "suk-3", food_name: "Melis", food_group_name: "Sukker og honning", search_keywords: ["sukker"] },
  { food_id: "suk-4", food_name: "Sirup", food_group_name: "Sukker og honning", search_keywords: ["sirup", "monin"] },

  // Margarin og smør
  { food_id: "smo-1", food_name: "Smør", food_group_name: "Margarin og smør" },
  { food_id: "smo-2", food_name: "Smør, usaltet", food_group_name: "Margarin og smør" },
  { food_id: "smo-3", food_name: "Brelett", food_group_name: "Margarin og smør", search_keywords: ["smør"] },
  { food_id: "smo-4", food_name: "Bremykt", food_group_name: "Margarin og smør", search_keywords: ["smør"] },
  // Basen kaller den «uspesifisert», ikke bare «Matlagingsfett».
  { food_id: "smo-5", food_name: "Matlagingsfett, uspesifisert", food_group_name: "Margarin og smør", search_keywords: ["smør"] },

  // Egg
  { food_id: "egg-1", food_name: "Egg, rå", food_group_name: "Egg" },
  { food_id: "egg-2", food_name: "Egg, kokt", food_group_name: "Egg" },
  { food_id: "egg-3", food_name: "Egg, stekt i fett", food_group_name: "Egg" },

  // Melk
  { food_id: "melk-1", food_name: "Helmelk, uspesifisert", food_group_name: "Melk" },
  { food_id: "melk-2", food_name: "Helmelk, 3,5 % fett, Tine", food_group_name: "Melk" },
  { food_id: "melk-2b", food_name: "Helmelk, 3,5 % fett, laktosefri", food_group_name: "Melk" },
  { food_id: "melk-3", food_name: "Helmelk, 4 % fett, Q-meieriene", food_group_name: "Melk" },
  { food_id: "melk-4", food_name: "Lettmelk, uspesifisert", food_group_name: "Melk" },
  { food_id: "melk-5", food_name: "Lettmelk, 1,0 % fett, Tine", food_group_name: "Melk" },
  { food_id: "melk-5b", food_name: "Lettmelk, 1 % fett, uspesifisert", food_group_name: "Melk" },
  { food_id: "melk-5c", food_name: "Lettmelk, 1 % fett, laktosefri", food_group_name: "Melk" },
  { food_id: "melk-6", food_name: "Lettmelk, 0,7 % fett, økologisk", food_group_name: "Melk" },
  { food_id: "melk-7", food_name: "Melk, uspesifisert", food_group_name: "Melk" },
  { food_id: "melk-8", food_name: "Skummet melk, Tine", food_group_name: "Melk" },
  { food_id: "melk-9", food_name: "Skummet melk, Styrk", food_group_name: "Melk" },

  // Fløte og rømme
  { food_id: "rom-1", food_name: "Lettrømme, 18 % fett", food_group_name: "Fløte og rømme" },
  { food_id: "rom-1b", food_name: "Lettrømme, 10 % fett", food_group_name: "Fløte og rømme" },
  { food_id: "rom-1c", food_name: "Lettrømme, 18 % fett, økologisk", food_group_name: "Fløte og rømme" },
  { food_id: "rom-2", food_name: "Seterrømme, 35 % fett", food_group_name: "Fløte og rømme" },
];
