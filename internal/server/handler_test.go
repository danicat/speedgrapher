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

package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestServer_CreateHTTPHandler_PanicRecovery(t *testing.T) {
	srv := New("test")
	panickingHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("simulated server panic")
	})

	handler := srv.createHTTPHandler(panickingHandler)
	req := httptest.NewRequest(http.MethodGet, "http://localhost:8080/mcp", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected status %d after panic recovery, got %d", http.StatusInternalServerError, rec.Code)
	}
}
