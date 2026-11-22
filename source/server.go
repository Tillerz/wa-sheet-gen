package main

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

const maxBody = 10 << 20

type server struct {
	token string
}

// newServer returns the HTTP handler: the embedded web UI plus the token-protected API.
func newServer(token string, web fs.FS) http.Handler {
	s := &server{token: token}
	api := http.NewServeMux()
	api.HandleFunc("GET /api/project/new", s.projectNew)
	api.HandleFunc("POST /api/project/open", s.projectOpen)
	api.HandleFunc("POST /api/project/save", s.projectSave)
	api.HandleFunc("GET /api/fs/list", s.fsList)
	api.HandleFunc("GET /api/rules", s.rules)

	mux := http.NewServeMux()
	mux.Handle("/api/", s.requireToken(api))
	mux.Handle("/", http.FileServerFS(web))
	return localOnly(mux)
}

// localOnly rejects requests whose Host is not the loopback address.
// This blocks DNS rebinding attacks from websites in the same browser.
func localOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil {
			host = r.Host
		}
		if host != "127.0.0.1" && host != "localhost" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) requireToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := r.Header.Get("X-Token")
		if subtle.ConstantTimeCompare([]byte(got), []byte(s.token)) != 1 {
			writeError(w, http.StatusUnauthorized, errors.New("invalid token: restart the app from its window"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) error {
	return json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(v)
}

// rules gives the UI the same naming rules the server checks, so they live in one place.
func (s *server) rules(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{
		"bannedWords":       bannedWords,
		"sheetNamePattern":  sheetNameRe.String(),
		"classNamePattern":  classNameRe.String(),
		"fieldNamePattern":  fieldNameRe.String(),
		"forbiddenPrefixes": forbiddenClassPrefixes,
	})
}

func (s *server) projectNew(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, newProject())
}

func (s *server) projectOpen(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Folder string `json:"folder"`
	}
	if err := readJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	p, err := loadProject(req.Folder)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, p)
}

func (s *server) projectSave(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Folder  string   `json:"folder"`
		Project *Project `json:"project"`
	}
	if err := readJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if req.Folder == "" || !filepath.IsAbs(req.Folder) || req.Project == nil {
		writeError(w, http.StatusBadRequest, errors.New("folder (absolute path) and project are required"))
		return
	}
	if err := saveProject(req.Folder, req.Project); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, map[string]string{"folder": req.Folder})
}

type dirEntry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	HasProject bool   `json:"hasProject"`
}

type dirListing struct {
	Path       string     `json:"path"`
	Parent     string     `json:"parent"`
	HasProject bool       `json:"hasProject"`
	Dirs       []dirEntry `json:"dirs"`
	Drives     []string   `json:"drives"`
}

func hasProject(dir string) bool {
	st, err := os.Stat(filepath.Join(dir, projectFile))
	return err == nil && !st.IsDir()
}

// defaultFolder is the user's Documents folder, or the home folder.
func defaultFolder() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return string(filepath.Separator)
	}
	docs := filepath.Join(home, "Documents")
	if st, err := os.Stat(docs); err == nil && st.IsDir() {
		return docs
	}
	return home
}

func windowsDrives() []string {
	if runtime.GOOS != "windows" {
		return nil
	}
	var drives []string
	for c := 'C'; c <= 'Z'; c++ {
		d := string(c) + `:\`
		if _, err := os.Stat(d); err == nil {
			drives = append(drives, d)
		}
	}
	return drives
}

func (s *server) fsList(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		path = defaultFolder()
	}
	path, err := filepath.Abs(path)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	out := dirListing{Path: path, HasProject: hasProject(path), Dirs: []dirEntry{}, Drives: windowsDrives()}
	if parent := filepath.Dir(path); parent != path {
		out.Parent = parent
	}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		p := filepath.Join(path, e.Name())
		out.Dirs = append(out.Dirs, dirEntry{Name: e.Name(), Path: p, HasProject: hasProject(p)})
	}
	sort.Slice(out.Dirs, func(i, j int) bool {
		return strings.ToLower(out.Dirs[i].Name) < strings.ToLower(out.Dirs[j].Name)
	})
	writeJSON(w, out)
}
