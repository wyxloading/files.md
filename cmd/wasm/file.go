package main

import (
	"io/fs"
	"os"
	"time"
)

type File struct {
	name    string
	size    int64
	mode    fs.FileMode
	modTime int
	isDir   bool
}

func NewFile(name string, modTime int, isDir bool) *File {
	return &File{
		name:    name,
		modTime: modTime,
		isDir:   isDir,
	}
}

func (f *File) Name() string {
	return f.name
}

func (f *File) Size() int64 {
	return 0
}

func (f *File) Mode() os.FileMode {
	return f.mode
}

func (f *File) ModTime() time.Time {
	return time.Unix(int64(f.modTime), 0)
}

func (f *File) IsDir() bool {
	return f.isDir
}

func (f *File) Sys() any {
	return nil
}
