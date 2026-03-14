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

package slop

import (
	"testing"
)

func TestCalculate(t *testing.T) {
	tests := []struct {
		name               string
		text               string
		wantScoreThreshold float64
	}{
		{
			name:               "empty text",
			text:               "",
			wantScoreThreshold: 0,
		},
		{
			name:               "natural text",
			text:               "This is a simple sentence written by a human being. It doesn't contain any weird words.",
			wantScoreThreshold: 0,
		},
		{
			name:               "heavy slop",
			text:               "We will delve into the multifaceted tapestry of this crucial paradigm. It is a testament to the intricate synergy we can harness to unlock a robust game changer.",
			wantScoreThreshold: 20.0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := Calculate(tt.text)
			if res.OverallScore < tt.wantScoreThreshold && tt.wantScoreThreshold > 0 {
				t.Errorf("Calculate() gotScore = %v, want >= %v", res.OverallScore, tt.wantScoreThreshold)
			}
		})
	}
}
