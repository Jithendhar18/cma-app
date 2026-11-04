/**
 * Normalised library model. Any future official-data adapter (ICMAI) only has to
 * produce `LibrarySource[]`; the UI discovers tabs and nesting from this data.
 */
export interface LibraryDocument {
  id: string;
  title: string;
  /** Free-form category label shown on the card, e.g. "MCQ set". */
  kind: string;
  subjectId?: string;
  year?: string;
  session?: string;
  pages?: number;
  url: string;
}

export interface LibraryNode {
  id: string;
  label: string;
  children?: LibraryNode[];
  documents?: LibraryDocument[];
}

export interface LibrarySource {
  id: string;
  label: string;
  description: string;
  /** Official page the data is expected to come from. */
  officialUrl: string;
  nodes: LibraryNode[];
}

export interface LibraryAdapter {
  id: string;
  label: string;
  isDemo: boolean;
  load: () => Promise<LibrarySource[]>;
}
