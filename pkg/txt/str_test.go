package txt

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPositiveI64ToStr(t *testing.T) {
	r := require.New(t)

	s := I64(1)

	r.Equal("1", s)
}

func TestNegativeI64ToStr(t *testing.T) {
	r := require.New(t)

	s := I64(-1)

	r.Equal("-1", s)
}

func TestZeroI64ToStr(t *testing.T) {
	r := require.New(t)

	s := I64(0)

	r.Equal("0", s)
}

func TestUcfirst(t *testing.T) {
	r := require.New(t)

	res := Ucfirst("abc")

	r.Equal("Abc", res)
}

func TestUcfirstRu(t *testing.T) {
	r := require.New(t)

	res := Ucfirst("абв")

	r.Equal("Абв", res)
}

func TestLcfirst(t *testing.T) {
	r := require.New(t)

	res := Lcfirst("ABC")

	r.Equal("aBC", res)
}

func TestLcfirstRu(t *testing.T) {
	r := require.New(t)

	res := Lcfirst("АБВ")

	r.Equal("аБВ", res)
}

func TestInsertTextAfterHeaderNoHeader(t *testing.T) {
	r := require.New(t)

	content := InsertTextAfterHeader("### header 1\nitem1\nitem2", "### header 5", "new item")

	r.Equal("### header 5\nnew item\n### header 1\nitem1\nitem2", content)
}

func TestInsertTextAfterHeader(t *testing.T) {
	r := require.New(t)

	content := InsertTextAfterHeader("### header 1\nitem1\nitem2\n### header 2", "### header 1", "new item")

	r.Equal("### header 1\nnew item\nitem1\nitem2\n### header 2", content)
}

func TestInsertTextAfterHeaderInTheMiddle(t *testing.T) {
	r := require.New(t)

	content := InsertTextAfterHeader("### header 0\n### header 1\nitem1\nitem2\n### header 2", "### header 1", "new item")

	r.Equal("### header 0\n### header 1\nnew item\nitem1\nitem2\n### header 2", content)
}

func TestInsertTextAfterHeaderInTheMiddleOnlyHeader(t *testing.T) {
	r := require.New(t)

	content := InsertTextAfterHeader("### header 0\n### header 1\n### header 2", "### header 1", "new item")

	r.Equal("### header 0\n### header 1\nnew item\n### header 2", content)
}
