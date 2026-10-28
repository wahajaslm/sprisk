# Composite Split example

This folder is the complete export behind the **Split choice example** screen.

- `split.py` is the editable node source. It contains one `@method` and its three
  `@operator` options.
- `exploration.yaml` is the only user-visible record. It stores the evidence snapshot,
  chosen operator, reason, and settings for this exploration.
- `customer-safe-split.ipynb` is ordinary Python. It contains the resolved `group_split`
  implementation and has no Sprisk or plugin import.

The web example keeps the node source, flow controls, and notebook cell synchronized in
memory. Changing the choice or a parameter rematerializes the notebook. Applying edited
notebook code updates the matching operator in the node source. Cell metadata retains the
node, method, and operator identity needed for the round trip.

The decorator runtime and persistent graph migration are intentionally outside this isolated
vertical example; the production graph still uses the current manifest contracts.
