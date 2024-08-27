package sched

import (
	"testing"
	"time"

	"zakirullin/stuffbot/pkg/txt"

	"github.com/stretchr/testify/require"
)

func TestUcfirst(t *testing.T) {
	r := require.New(t)

	res := txt.Ucfirst("abc")

	r.Equal("Abc", res)
}

func TestUcfirstRu(t *testing.T) {
	r := require.New(t)

	res := txt.Ucfirst("абв")

	r.Equal("Абв", res)
}

func TestTomorrow(t *testing.T) {
	r := require.New(t)

	savedNow := Now
	defer func() {
		Now = savedNow
	}()
	Now = func() time.Time {
		return time.Date(1970, 1, 1, 10, 45, 10, 0, time.UTC)
	}

	tomorrow := Tomorrow()
	r.Equal(time.Date(1970, 1, 2, 0, 0, 0, 0, time.UTC).Unix(), tomorrow)
}

func TestFormatTaskDate(t *testing.T) {
	r := require.New(t)

	savedNow := Now
	defer func() {
		Now = savedNow
	}()
	Now = func() time.Time {
		return time.Date(1970, 1, 1, 10, 45, 10, 0, time.UTC)
	}

	r.Equal("Today", formatTaskDate(0))
	r.Equal("Today", formatTaskDate(10))         // seconds are ignored
	r.Equal("Today", formatTaskDate(60*60*2))    // hours are ignored
	r.Equal("Today", formatTaskDate(60*60*24-1)) // hours are ignored
	r.Equal("Tomorrow", formatTaskDate(60*60*24))
	r.Equal("Tomorrow", formatTaskDate(60*60*24))
	r.Equal("Saturday 03", formatTaskDate(60*60*24*2))
	r.Equal("Wednesday 07", formatTaskDate(60*60*24*6))
	r.Equal("Next Thursday 08", formatTaskDate(60*60*24*7))
}
