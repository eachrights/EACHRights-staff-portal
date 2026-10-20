import { useMemo } from "react";

import MoveDialog, { buildFolderOptions } from "./MoveDialog";
import { apiRequest } from "./api";

/*
 * Drop-in "move a file" dialog for any page.
 *
 *   <MoveFile
 *     file={moveTarget}            the file to move ({ key, name }), or null to hide the dialog
 *     files={files}                the files the page has loaded (used to find subfolders)
 *     roots={[{ prefix, label }]}  the folders this page may move files into
 *     onClose={() => setMoveTarget(null)}
 *     onMoved={() => { setMoveTarget(null); reloadFiles(); }}
 *   />
 *
 * Optional: path="/admin/files/move" is the API route (change it for staff pages
 * if they use a different one). The request is POST { key, targetPrefix }.
 */
function MoveFile({
  file,
  files = [],
  roots = [],
  onClose,
  onMoved,
  path = "/admin/files/move",
}) {
  const folders = useMemo(() => buildFolderOptions(files, roots), [files, roots]);

  const handleMove = async (targetPrefix) => {
    await apiRequest(path, {
      method: "POST",
      body: { key: file.key, targetPrefix },
    });

    onMoved?.(targetPrefix);
  };

  if (!file) return null;

  return (
    <MoveDialog
      file={file}
      folders={folders}
      onClose={onClose}
      onMove={handleMove}
    />
  );
}

export default MoveFile;
