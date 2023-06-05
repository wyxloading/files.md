//go:build windows

package fs

import (
	"os"
	"syscall"
)

var Ctime = func(fi os.FileInfo) int64 {
	stat := fi.Sys().(*syscall.Win32FileAttributeData)
	return stat.LastAccessTime.Nanoseconds() / 1000_000_000
}
