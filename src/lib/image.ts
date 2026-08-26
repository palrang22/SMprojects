/** 스튜디오 공용 — 파일 입력에서 받은 이미지를 base64 로 읽는다 */
export type Attachment = {
  id: string;
  name: string;
  data: string; // base64 (data: 접두사 제거됨)
  mimeType: string;
  preview: string; // data: URL, 미리보기용
};

export function readAsAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} 을 읽지 못했습니다`));
    reader.onload = () => {
      const url = String(reader.result);
      const comma = url.indexOf(",");
      resolve({
        id: `${file.name}-${file.size}-${Date.now()}`,
        name: file.name,
        data: url.slice(comma + 1),
        mimeType: file.type || "image/png",
        preview: url,
      });
    };
    reader.readAsDataURL(file);
  });
}
