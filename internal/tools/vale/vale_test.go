// Copyright 2025 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package vale

import (
	"context"
	"testing"
)

func TestValeHandler(t *testing.T) {
	ctx := context.Background()
	params := ValeParams{
		Text: "This is a test test.",
	}

	_, result, err := valeHandler(ctx, nil, params)
	if err != nil {
		t.Fatalf("valeHandler failed: %v", err)
	}

	if result == nil {
		t.Fatal("expected result, got nil")
	}

	found := false
	for _, alert := range result.Alerts {
		if alert.Check == "Vale.Repetition" {
			found = true
			break
		}
	}

	if !found {
		t.Errorf("expected Vale.Repetition alert, but it was not found in %v", result.Alerts)
	}
}
