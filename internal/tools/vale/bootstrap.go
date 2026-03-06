package vale

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const valeVersion = "3.13.1"
const valeBaseURL = "https://github.com/errata-ai/vale/releases/download/v" + valeVersion + "/"

var valeChecksums = map[string]string{
	"vale_3.13.1_Linux_64-bit.tar.gz": "99bd899f0ac52054444ffe3df571c749cc811f3b606cf5ef740c9a5a2db33df6",
	"vale_3.13.1_Linux_arm64.tar.gz":  "bf732cb7cd1942e007ff1c24e652dff852c58e6ca467312d5955c74469d4fc70",
	"vale_3.13.1_Windows_64-bit.zip":  "cdf83d17277e097b84e34a550c8dd6b870c582c3022caecc4b6b363352dd491c",
	"vale_3.13.1_macOS_64-bit.tar.gz": "bbc3a94f3e6640b8a8d6e349142cbe3d0f597e6a673fcad5de4ae9dc88e5c7e1",
	"vale_3.13.1_macOS_arm64.tar.gz":  "b614dfde6324eec403ac540cbcd47132960f8ebe9c21ef0e2352da9b19808689",
}

func getValeAssetInfo() (string, string, error) {
	osName := ""
	switch runtime.GOOS {
	case "darwin":
		osName = "macOS"
	case "linux":
		osName = "Linux"
	case "windows":
		osName = "Windows"
	default:
		return "", "", fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}

	archName := ""
	switch runtime.GOARCH {
	case "amd64":
		archName = "64-bit"
	case "arm64":
		archName = "arm64"
	default:
		return "", "", fmt.Errorf("unsupported architecture: %s", runtime.GOARCH)
	}

	ext := ".tar.gz"
	if runtime.GOOS == "windows" {
		ext = ".zip"
	}

	assetName := fmt.Sprintf("vale_%s_%s_%s%s", valeVersion, osName, archName, ext)
	checksum, ok := valeChecksums[assetName]
	if !ok {
		return "", "", fmt.Errorf("no checksum found for asset: %s", assetName)
	}

	return assetName, checksum, nil
}

// bootstrapVale ensures the pinned version of vale is available and returns its path.
func bootstrapVale() (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("could not determine executable path: %w", err)
	}
	exeDir := filepath.Dir(exePath)

	valeBinName := "vale"
	if runtime.GOOS == "windows" {
		valeBinName = "vale.exe"
	}
	valePath := filepath.Join(exeDir, valeBinName)

	// Check if already installed and correct version
	if _, err := os.Stat(valePath); err == nil {
		cmd := exec.Command(valePath, "-v")
		if out, err := cmd.Output(); err == nil {
			if strings.Contains(string(out), valeVersion) {
				return valePath, nil // Already bootstrapped with correct version
			}
		}
	}

	assetName, expectedChecksum, err := getValeAssetInfo()
	if err != nil {
		return "", err
	}

	url := valeBaseURL + assetName
	resp, err := http.Get(url)
	if err != nil {
		return "", fmt.Errorf("failed to download vale: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to download vale, status code: %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read downloaded data: %w", err)
	}

	// Verify checksum
	hash := sha256.Sum256(data)
	actualChecksum := hex.EncodeToString(hash[:])
	if actualChecksum != expectedChecksum {
		return "", fmt.Errorf("checksum mismatch for %s: expected %s, got %s", assetName, expectedChecksum, actualChecksum)
	}

	// Extract
	if strings.HasSuffix(assetName, ".zip") {
		if err := extractZip(data, valePath, valeBinName); err != nil {
			return "", err
		}
	} else if strings.HasSuffix(assetName, ".tar.gz") {
		if err := extractTarGz(data, valePath, valeBinName); err != nil {
			return "", err
		}
	} else {
		return "", fmt.Errorf("unsupported archive format: %s", assetName)
	}

	return valePath, nil
}

func extractZip(data []byte, destPath string, binName string) error {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return fmt.Errorf("failed to open zip: %w", err)
	}

	for _, f := range r.File {
		if f.Name == binName {
			rc, err := f.Open()
			if err != nil {
				return err
			}
			defer func() { _ = rc.Close() }()
			return writeExecutable(rc, destPath)
		}
	}
	return fmt.Errorf("binary %s not found in zip archive", binName)
}

func extractTarGz(data []byte, destPath string, binName string) error {
	gr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("failed to create gzip reader: %w", err)
	}
	defer func() { _ = gr.Close() }()

	tr := tar.NewReader(gr)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to read tar header: %w", err)
		}

		if header.Typeflag == tar.TypeReg && header.Name == binName {
			return writeExecutable(tr, destPath)
		}
	}
	return fmt.Errorf("binary %s not found in tar.gz archive", binName)
}

func writeExecutable(r io.Reader, destPath string) error {
	f, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return fmt.Errorf("failed to open destination file %s: %w", destPath, err)
	}
	defer func() { _ = f.Close() }()

	if _, err := io.Copy(f, r); err != nil {
		return fmt.Errorf("failed to write binary: %w", err)
	}
	return nil
}
