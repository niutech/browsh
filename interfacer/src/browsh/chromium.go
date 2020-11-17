package browsh

import (
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/gdamore/tcell"
	"github.com/go-errors/errors"
	"github.com/spf13/viper"
	"github.com/wirepair/gcd/v2"
)

var (
	debugger = gcd.NewChromeDebugger()
)

func startChromiumBrowser() {
	Log("Starting Chromium Browser")
	checkIfChromiumIsAlreadyRunning()
	// TODO
}

func checkIfChromiumIsAlreadyRunning() {
	if runtime.GOOS == "windows" {
		return
	}
	processes := Shell("ps aux")
	r, _ := regexp.Compile("chromium-browser")
	if r.MatchString(processes) {
		Shutdown(errors.New("Chromium is already running"))
	}
}

// Connect to Chromium Remote Debugger
func connectToCRD() {
	var err error
	connected := false
	Log("Attempting to connect to Chromium Remote Debugger")
	start := time.Now()
	for time.Since(start) < 30*time.Second {
		debugger.ConnectToInstance("127.0.0.1", "9222")
		_, err = debugger.GetFirstTab()
		if err != nil {
			if !strings.Contains(err.Error(), "refused") {
				Shutdown(err)
			} else {
				time.Sleep(10 * time.Millisecond)
				continue
			}
		} else {
			connected = true
			break
		}
	}
	if !connected {
		Shutdown(errors.New("Failed to connect to Chromium Remote Debuggr within 30 seconds"))
	}
}

func setupCRD() {
	go startChromiumBrowser()
	if *timeLimit > 0 {
		go beginTimeLimit()
	}
	connectToCRD()
}

func StartChromium() {
	if !viper.GetBool("chromium.use-existing") {
		writeString(0, 16, "Waiting for Chromium to connect...", tcell.StyleDefault)
		if IsTesting {
			writeString(0, 17, "TEST MODE", tcell.StyleDefault)
			go startChromiumBrowser()
//			connectToCRD()
		} else {
//			setupCRD()
		}
	} else {
//		connectToCRD()
		writeString(0, 16, "Waiting for a user-initiated Chromium instance to connect...", tcell.StyleDefault)
	}
}

func quitChromium() {
	debugger.ExitProcess()
}
