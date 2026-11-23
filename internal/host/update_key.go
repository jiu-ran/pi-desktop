package host

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"strings"
)

// updatePublicKeyBase64 是发布签名公钥（ed25519，base64）。
//
// 通过 -ldflags 注入：
//
//	go build -ldflags "-X github.com/jiu-ran/pi-desktop/internal/host.updatePublicKeyBase64=<base64 公钥>"
//
// 为空表示这个构建不信任任何下载的安装包：只提供「打开发布页手动下载」。
// 用 scripts/gen-update-key.mjs 生成密钥对。
var updatePublicKeyBase64 = ""

// updateSigningKey 解析注入的公钥；未配置或格式不对时返回错误。
func updateSigningKey() (ed25519.PublicKey, error) {
	raw := strings.TrimSpace(updatePublicKeyBase64)
	if raw == "" {
		return nil, errors.New("当前构建没有内置更新签名公钥，无法校验安装包签名")
	}
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		data, err := encoding.DecodeString(raw)
		if err == nil && len(data) == ed25519.PublicKeySize {
			return ed25519.PublicKey(data), nil
		}
	}
	return nil, errors.New("内置的更新签名公钥格式不正确")
}

// verifyUpdateSignature 校验 SHA256SUMS.txt 的 ed25519 签名（.sig 是原始的 64 字节签名）。
func verifyUpdateSignature(publicKey ed25519.PublicKey, sums, signature []byte) error {
	if len(signature) != ed25519.SignatureSize {
		return errors.New("更新签名文件长度不正确")
	}
	if !ed25519.Verify(publicKey, sums, signature) {
		return errors.New("更新签名校验失败")
	}
	return nil
}
