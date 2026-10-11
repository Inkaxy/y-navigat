# Live-speil av rot-migrasjoner

Byte-identiske kopier av SQL som root har kjørt direkte mot live-databasen (hentet fra
`supabase_migrations.schema_migrations.statements`, md5 verifisert). Filnavn = live versjon + navn.
Ligger utenfor `supabase/migrations` fordi den mappen styres av migrasjonsverktøyet, som ville kjørt SQL-en på nytt.
Skal ALDRI kjøres på nytt.
