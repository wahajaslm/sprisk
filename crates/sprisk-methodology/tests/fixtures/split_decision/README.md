The split decision in the ADR-0063 shape, ported from the spike as a catalog fixture. Its
producers are the registered plugins: `sprisk.profile.near_duplicates` before the split,
`sprisk.validation.group_overlap`, `sprisk.validation.row_overlap` and `sprisk.validation.time_order` after it. The real
methods live in `methodology/common` and `methodology/supervised`; this copy lets tests edit
them without touching the packs.
