/** The step of an edge end, `<node_id>.<port>`. */
export const stepOf = (end: string) => end.split(".")[0] ?? end;

/** The port of an edge end, `<node_id>.<port>`. */
export const portOf = (end: string) => end.split(".")[1] ?? end;
