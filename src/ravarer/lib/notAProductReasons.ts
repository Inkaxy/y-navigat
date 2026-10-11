/**
 * Ett vokabular for linjer som ikke er en vare (frakt, gebyr og lignende).
 * Egen fil for å unngå importsyklus mellom etikettene i Råvarer og Fakturaer.
 */
export const NOT_A_PRODUCT_LABEL = "Ikke vare";

export const NOT_A_PRODUCT_REASONS = ["Frakt", "Gebyr/avgift", "Pant", "Rabatt", "Annet"] as const;

export type NotAProductReason = (typeof NOT_A_PRODUCT_REASONS)[number];
