package host

import "errors"

// sessionImage 按引用取回历史分页里被替换成大图引用的图片数据。
//
// ref 由 historyForPage 生成，形如 "<会话文件>|消息序号:图片序号"；会话文件必须属于
// 当前项目（assertReadableSessionFile 会校验），所以界面拿到的 ref 不能用来读任意文件。
func (h *Host) sessionImage(cwd, ref string) (map[string]any, error) {
	file, messageIndex, partIndex, ok := parseImageRef(ref)
	if !ok {
		return nil, errors.New("图片引用无效")
	}
	target, err := assertReadableSessionFile(cwd, file)
	if err != nil {
		return nil, err
	}
	history := readSessionHistory(target)
	if messageIndex >= len(history) {
		return nil, errors.New("图片已失效（会话内容有变化）")
	}
	parts, _ := history[messageIndex]["content"].([]any)
	if partIndex >= len(parts) {
		return nil, errors.New("图片已失效（会话内容有变化）")
	}
	part := asMap(parts[partIndex])
	data := asString(part["data"])
	if asString(part["type"]) != "image" || data == "" {
		return nil, errors.New("这一条消息里没有图片数据")
	}
	return map[string]any{
		"mimeType": firstNonEmpty(asString(part["mimeType"]), "image/png"),
		"data":     data,
		"bytes":    len(data) * 3 / 4,
	}, nil
}
