package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

// The UI keeps its settings (recent folders, canvas theme, …) in a file, not in the
// browser: the app gets a new port on every start, and the browser stores per port.

const maxSettings = 64 << 10

type settingsStore struct {
	path string
	mu   sync.Mutex
}

// defaultSettingsPath is %AppData%\wa-sheet-gen\settings.json on Windows.
func defaultSettingsPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "wa-sheet-gen", "settings.json")
}

func (st *settingsStore) get(w http.ResponseWriter, r *http.Request) {
	st.mu.Lock()
	defer st.mu.Unlock()
	data, err := os.ReadFile(st.path)
	if err != nil || !json.Valid(data) {
		writeJSON(w, map[string]any{})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func (st *settingsStore) put(w http.ResponseWriter, r *http.Request) {
	if st.path == "" {
		writeError(w, http.StatusInternalServerError, errors.New("no settings folder"))
		return
	}
	var v map[string]any
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxSettings)).Decode(&v); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(st.path), 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if err := os.WriteFile(st.path, data, 0o644); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}
