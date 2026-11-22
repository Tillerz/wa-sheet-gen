package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"time"
)

//go:embed web
var webFiles embed.FS

func main() {
	tokenBytes := make([]byte, 16)
	if _, err := rand.Read(tokenBytes); err != nil {
		log.Fatal(err)
	}
	token := hex.EncodeToString(tokenBytes)

	web, err := fs.Sub(webFiles, "web")
	if err != nil {
		log.Fatal(err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	url := fmt.Sprintf("http://%s/?t=%s", ln.Addr(), token)

	fmt.Println("WA Sheet Generator is running.")
	fmt.Println("If no browser opens, open this address:")
	fmt.Println("  " + url)
	fmt.Println("Close this window to quit.")
	if err := openBrowser(url); err != nil {
		fmt.Println("Could not open the browser:", err)
	}

	srv := &http.Server{Handler: newServer(token, web), ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(srv.Serve(ln))
}

func openBrowser(url string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}
