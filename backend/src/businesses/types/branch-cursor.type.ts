/** Filters a branch cursor is bound to; a cursor is rejected under other filters. */
export type BranchCursorContext = {
  businessId: string;
  from: Date | null;
  to: Date | null;
  branchId: string | null;
};

/** Keyset position: the last row of the previous page. */
export type BranchCursor = {
  createdAt: Date;
  id: string;
};
