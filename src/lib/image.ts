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

/** 같은 출처의 이미지 URL(예: public/samples 의 샘플 인물)을 Attachment 로 만든다 */
export async function attachmentFromUrl(
  url: string,
  name: string,
): Promise<Attachment> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name} 을 불러오지 못했습니다 (${res.status})`);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error(`${name} 파일이 이미지가 아닙니다`);
  }
  return readAsAttachment(new File([blob], name, { type: blob.type }));
}

/** 이미 base64 를 들고 있을 때 (예: 생성 결과를 다시 인물 입력으로 넣기) */
export function attachmentFromBase64(
  data: string,
  mimeType: string,
  name: string,
): Attachment {
  return {
    id: `${name}-${Date.now()}`,
    name,
    data,
    mimeType,
    preview: `data:${mimeType};base64,${data}`,
  };
}
