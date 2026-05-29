import React, { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog"; // Add this new import
import "./App.css";

interface FileItem {
  name: string;
  is_dir: boolean;
  date_str: string;
  timestamp: number;
}

type SortKey = "name" | "date" | "type";
type SortDir = "asc" | "desc";

function App() {
  const [localPath, setLocalPath] = useState("~/Downloads");
  const [remotePath, setRemotePath] = useState("/sdcard/DCIM");

  const [localFiles, setLocalFiles] = useState<FileItem[]>([]);
  const [remoteFiles, setRemoteFiles] = useState<FileItem[]>([]);

  // Selection & Finder-style Range tracking
  const [selectedRemote, setSelectedRemote] = useState<string[]>([]);
  const [lastRemoteIndex, setLastRemoteIndex] = useState<number | null>(null);

  const [selectedLocal, setSelectedLocal] = useState<string[]>([]);
  const [lastLocalIndex, setLastLocalIndex] = useState<number | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [statusMsg, setStatusMsg] = useState("Ready");
  const [isTransferring, setIsTransferring] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, file_name: "" });

  // --- Folder Selection ---
  const handleSelectLocalFolder = async () => {
    try {
      const selected = await open({
        directory: true, // Tells Mac we want a folder, not a file
        multiple: false,
        title: "Select Transfer Destination",
      });

      // If the user selects a folder (doesn't hit Cancel)
      if (selected !== null) {
        setLocalPath(selected as string);
      }
    } catch (err) {
      setStatusMsg(`Dialog Error: ${err}`);
    }
  };

  // --- Fetchers ---
  const fetchLocalFiles = async () => {
    try {
      const files: FileItem[] = await invoke("list_local_files", { path: localPath });
      setLocalFiles(files);
    } catch (err) { setStatusMsg(`Error: ${err}`); }
  };

  const fetchRemoteFiles = async () => {
    try {
      const files: FileItem[] = await invoke("list_remote_files", { path: remotePath });
      // Convert Android date strings to timestamps for uniform sorting
      const processed = files.map(f => {
        const ts = new Date(f.date_str.replace(" ", "T")).getTime();
        return { ...f, timestamp: isNaN(ts) ? 0 : ts };
      });
      setRemoteFiles(processed);
      setSelectedRemote([]);
      setLastRemoteIndex(null);
    } catch (err) { setStatusMsg(`Error: ${err}`); }
  };

  useEffect(() => { fetchLocalFiles(); }, [localPath]);
  useEffect(() => { fetchRemoteFiles(); }, [remotePath]);
  useEffect(() => {
    const unlisten = listen("transfer-progress", (event: any) => {
      setProgress(event.payload);
    });

    // Cleanup the listener when component unmounts
    return () => {
      unlisten.then(f => f());
    };
  }, []);

  // --- Sorting Logic ---
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const getSortedFiles = (files: FileItem[]) => {
    return [...files].sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1; // Folders always on top

      let valA, valB;
      if (sortKey === "name") {
        valA = a.name.toLowerCase(); valB = b.name.toLowerCase();
      } else if (sortKey === "date") {
        valA = a.timestamp; valB = b.timestamp;
      } else {
        valA = a.name.split('.').pop()?.toLowerCase() || "";
        valB = b.name.split('.').pop()?.toLowerCase() || "";
      }

      if (valA < valB) return sortDir === "asc" ? -1 : 1;
      if (valA > valB) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  };

  const sortedRemoteFiles = useMemo(() => getSortedFiles(remoteFiles), [remoteFiles, sortKey, sortDir]);

  // --- Selection Logic (The Finder Magic) ---
  const handleRemoteRowClick = (e: React.MouseEvent, index: number, fileName: string) => {
    e.stopPropagation();

    if (e.metaKey || e.ctrlKey) {
      // Cmd/Ctrl Click: Toggle individual file
      setSelectedRemote(prev =>
        prev.includes(fileName) ? prev.filter(f => f !== fileName) : [...prev, fileName]
      );
      setLastRemoteIndex(index);
    } else if (e.shiftKey && lastRemoteIndex !== null) {
      // Shift Click: Select Range
      const start = Math.min(lastRemoteIndex, index);
      const end = Math.max(lastRemoteIndex, index);
      const range = sortedRemoteFiles.slice(start, end + 1).map(f => f.name);

      // Combine with existing selection if Cmd is also held, otherwise replace
      setSelectedRemote(e.metaKey ? [...new Set([...selectedRemote, ...range])] : range);
    } else {
      // Standard Click: Select only this file
      setSelectedRemote([fileName]);
      setLastRemoteIndex(index);
    }
  };

  // Local Selection Logic
  const handleLocalRowClick = (e: React.MouseEvent, index: number, fileName: string) => {
    e.stopPropagation();
    const sortedLocal = getSortedFiles(localFiles);

    if (e.metaKey || e.ctrlKey) {
      setSelectedLocal(prev => prev.includes(fileName) ? prev.filter(f => f !== fileName) : [...prev, fileName]);
      setLastLocalIndex(index);
    } else if (e.shiftKey && lastLocalIndex !== null) {
      const start = Math.min(lastLocalIndex, index);
      const end = Math.max(lastLocalIndex, index);
      const range = sortedLocal.slice(start, end + 1).map(f => f.name);
      setSelectedLocal(e.metaKey ? [...new Set([...selectedLocal, ...range])] : range);
    } else {
      setSelectedLocal([fileName]);
      setLastLocalIndex(index);
    }
  };

  // Mac Navigation Logic
  const handleLocalNavigate = (folder: string) => {
    setLocalPath((prev) => prev.endsWith("/") ? `${prev}${folder}` : `${prev}/${folder}`);
    setSelectedLocal([]);
  };

  const handleLocalBack = () => {
    if (localPath === "/" || localPath === "~") return; // Already at root
    const parts = localPath.split("/").filter(Boolean);

    if (parts.length > 1) {
      parts.pop();
      setLocalPath(localPath.startsWith("~") ? parts.join("/") : "/" + parts.join("/"));
    } else {
      setLocalPath(localPath.startsWith("~") ? "~" : "/");
    }
    setSelectedLocal([]);
  };

  // Push Logic
  const handlePushToPhone = async () => {
    if (selectedLocal.length === 0 || isTransferring) return;
    setIsTransferring(true);
    setProgress({ current: 0, total: selectedLocal.length, file_name: "Preparing..." });
    setStatusMsg(`Pushing ${selectedLocal.length} items to S25...`);
    try {
      const fullPaths = selectedLocal.map(file => `${localPath}/${file}`.replace("//", "/"));
      await invoke("push_multiple", { localPaths: fullPaths, remoteDest: remotePath });
      setStatusMsg(`✅ Pushed ${selectedLocal.length} items!`);
      setSelectedLocal([]);
      fetchRemoteFiles(); // Refresh S25 pane to show new files
    } catch (err) { setStatusMsg(`❌ Failed: ${err}`); }
    setIsTransferring(false);
  };

  const handleCancel = async () => {
    setStatusMsg("Cancelling batch...");
    await invoke("cancel_transfer");
    // We don't need to manually set isTransferring to false here, 
    // because the Rust loop will exit and the main transfer function will finish and clean itself up!
  };

  // --- Navigation & Transfer ---
  // --- S25 Ultra Navigation Logic ---
  const handleRemoteNavigate = (folder: string) => {
    setRemotePath(p => p.endsWith("/") ? `${p}${folder}` : `${p}/${folder}`);
    setSelectedRemote([]);
  };

  const handleRemoteBack = () => {
    // Safety lock: Prevent navigating above internal storage to avoid ADB permission crashes
    if (remotePath === "/sdcard" || remotePath === "/storage/emulated/0" || remotePath === "/") {
      setRemotePath("/sdcard");
      setSelectedRemote([]);
      return;
    }

    const parts = remotePath.split("/").filter(Boolean);
    parts.pop(); // Go up one folder

    // If we somehow empty the path, default back to safe storage
    setRemotePath(parts.length > 0 ? "/" + parts.join("/") : "/sdcard");
    setSelectedRemote([]);
  };

  const handlePullFromPhone = async () => {
    if (selectedRemote.length === 0 || isTransferring) return;
    setIsTransferring(true);
    setProgress({ current: 0, total: selectedRemote.length, file_name: "Preparing..." });
    setStatusMsg(`Pulling ${selectedRemote.length} items to Mac...`);
    try {
      const fullPaths = selectedRemote.map(file => `${remotePath}/${file}`.replace("//", "/"));
      await invoke("pull_multiple", { remotePaths: fullPaths, localDest: localPath });
      setStatusMsg(`✅ Transferred ${selectedRemote.length} items!`);
      setSelectedRemote([]);
      fetchLocalFiles();
    } catch (err) { setStatusMsg(`❌ Failed: ${err}`); }
    setIsTransferring(false);
  };

  const formatDate = (file: FileItem, isMac: boolean) => {
    if (isMac) return new Date(file.timestamp * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return file.date_str; // Android already formatted via ls
  };

  const SortIndicator = ({ column }: { column: SortKey }) =>
    sortKey === column ? <span>{sortDir === "asc" ? " ▲" : " ▼"}</span> : null;

  return (
    <div className="container" onClick={() => setSelectedRemote([])}>
      <header className="header">
        <h1>S25 Transfer Sync</h1>
        <div className="header-controls">
          <button className="universal-refresh-btn" onClick={() => { fetchLocalFiles(); fetchRemoteFiles(); }} title="Refresh Both Panes">
            ↻ Refresh All
          </button>
          <span className="status">{statusMsg}</span>
        </div>
      </header>

      <main className="dual-pane">
        {/* Left Pane (Mac) - Kept simple for display */}
        <section className="pane">
          <div className="pane-header">
            <h2>Mac (Local)</h2>
            <div className="path-controls">
              <button onClick={handleLocalBack}>⬆️ Back</button>
              <button onClick={handleSelectLocalFolder} title="Change Destination">📂 Target</button>
              <button onClick={fetchLocalFiles} title="Refresh">↻</button>
              <span className="path-display">{localPath}</span>
            </div>
          </div>
          <div className="file-grid-container">
            <div className="grid-header">
              <div className="col-name">Name</div>
              <div className="col-date">Date Modified</div>
            </div>
            <div className="file-list">
              {getSortedFiles(localFiles).map((file, index) => {
                const isSelected = selectedLocal.includes(file.name);
                return (
                  <div
                    key={file.name}
                    className={`grid-row interactive ${isSelected ? "selected" : ""}`}
                    onClick={(e) => handleLocalRowClick(e, index, file.name)}
                    onDoubleClick={() => file.is_dir ? handleLocalNavigate(file.name) : null}
                  >
                    <div className="col-name">
                      {file.is_dir ? "📁" : "📄"} <span className="truncate">{file.name}</span>
                    </div>
                    <div className="col-date">{formatDate(file, true)}</div>
                    <div className="col-type">{file.is_dir ? "Folder" : file.name.split('.').pop()?.toUpperCase()}</div>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Add the Action Bar here, balancing the UI! */}
          <div className="action-bar" style={{ justifyContent: 'flex-start' }}>
            {isTransferring ? (
              <div className="progress-container" style={{ flexDirection: 'row', alignItems: 'center', gap: '12px', width: '100%' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div className="progress-info">
                    <span>Pushing: {progress.file_name || "Preparing..."}</span>
                    <span>{progress.current} / {progress.total}</span>
                  </div>
                  <div className="progress-bar-bg">
                    <div className="progress-bar-fill" style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}></div>
                  </div>
                </div>
                <button onClick={handleCancel} style={{ background: '#ff3b30', color: 'white', padding: '6px 12px', fontSize: '11px' }}>Cancel 🛑</button>
              </div>
            ) : (
              <button disabled={selectedLocal.length === 0} onClick={handlePushToPhone}>
                Push {selectedLocal.length > 0 ? selectedLocal.length : ""} to S25 ➡️
              </button>
            )}
          </div>
        </section>

        {/* Right Pane (S25) - Fully Interactive */}
        <section className="pane">
          <div className="pane-header">
            <h2>S25 Ultra (Remote)</h2>
            <div className="path-controls">
              <button onClick={handleRemoteBack}>⬆️ Back</button>
              <button onClick={() => setRemotePath("/storage/emulated/0")} title="Main Phone Storage">📱 Storage</button>
              <button onClick={fetchRemoteFiles} title="Refresh">↻</button>
              <span className="path-display">{remotePath}</span>
            </div>
          </div>
          <div className="file-grid-container">
            <div className="grid-header interactive">
              <div className="col-name" onClick={() => handleSort("name")}>Name <SortIndicator column="name" /></div>
              <div className="col-date" onClick={() => handleSort("date")}>Date Modified <SortIndicator column="date" /></div>
              <div className="col-type" onClick={() => handleSort("type")}>Type <SortIndicator column="type" /></div>
            </div>
            <div className="file-list">
              {sortedRemoteFiles.map((file, index) => {
                const isSelected = selectedRemote.includes(file.name);
                return (
                  <div
                    key={file.name}
                    className={`grid-row interactive ${isSelected ? "selected" : ""}`}
                    onClick={(e) => handleRemoteRowClick(e, index, file.name)}
                    onDoubleClick={() => file.is_dir ? handleRemoteNavigate(file.name) : null}
                  >
                    <div className="col-name">
                      {file.is_dir ? "📁" : "📄"} <span className="truncate">{file.name}</span>
                    </div>
                    <div className="col-date">{formatDate(file, false)}</div>
                    <div className="col-type">{file.is_dir ? "Folder" : file.name.split('.').pop()?.toUpperCase()}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="action-bar">
            {isTransferring ? (
              <div className="progress-container" style={{ flexDirection: 'row', alignItems: 'center', gap: '12px', width: '100%' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div className="progress-info">
                    <span>Pulling: {progress.file_name || "Preparing..."}</span>
                    <span>{progress.current} / {progress.total}</span>
                  </div>
                  <div className="progress-bar-bg">
                    <div className="progress-bar-fill" style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}></div>
                  </div>
                </div>
                <button onClick={handleCancel} style={{ background: '#ff3b30', color: 'white', padding: '6px 12px', fontSize: '11px' }}>Cancel 🛑</button>
              </div>
            ) : (
              <button disabled={selectedRemote.length === 0} onClick={handlePullFromPhone}>
                ⬅️ Pull {selectedRemote.length > 0 ? selectedRemote.length : ""} to Mac
              </button>
            )}
          </div>
        </section>
      </main>
    </div >
  );
}

export default App;