package relays

import (
	"testing"

	"tailscale.com/tailcfg"
)

func TestChinaRegionEmpty(t *testing.T) {
	if ChinaRegion("") != nil || ChinaRegion("  ") != nil {
		t.Fatal("blank host must be nil")
	}
	reg := ChinaRegion("derp.example.com")
	if reg == nil || reg.RegionID != ChinaRegionID || len(reg.Nodes) != 1 {
		t.Fatalf("got %+v", reg)
	}
	if reg.Nodes[0].HostName != "derp.example.com" {
		t.Fatalf("host %q", reg.Nodes[0].HostName)
	}
}

func TestIsStockTailcat(t *testing.T) {
	if IsStockTailcat(&tailcfg.DERPRegion{RegionID: 304}) != true {
		t.Fatal("304 should be stock")
	}
	if IsStockTailcat(&tailcfg.DERPRegion{
		RegionID: 12,
		Nodes:    []*tailcfg.DERPNode{{HostName: "tc304a.ipn.dev"}},
	}) != true {
		t.Fatal("ipn.dev should be stock")
	}
	if IsStockTailcat(&tailcfg.DERPRegion{RegionID: ChinaRegionID}) != false {
		t.Fatal("900 is not stock")
	}
}

func TestMergeChina(t *testing.T) {
	dm := &tailcfg.DERPMap{Regions: map[int]*tailcfg.DERPRegion{
		304: {RegionID: 304},
	}}
	MergeChina(dm, "derp.example.com")
	if dm.Regions[ChinaRegionID] == nil || dm.Regions[304] == nil {
		t.Fatalf("merged map: %+v", dm.Regions)
	}
}
