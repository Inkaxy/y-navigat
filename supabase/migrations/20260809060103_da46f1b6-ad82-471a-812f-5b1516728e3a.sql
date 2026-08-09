UPDATE public.label_field_catalog
SET source_label = 'Tildeles når bestillingen kommer inn (én serie per dag)',
    description = 'Løpenummer for etiketten. Én serie per dag for hele selskapet. Nummeret settes når bestillingen registreres og beholdes ved reprint. Kansellerte etiketter gir hull i serien. Skrives alltid stort og fett på etiketten.'
WHERE field_key = 'etikett_nr';