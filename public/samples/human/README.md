# 샘플 인물 사진

Look Studio(02) 인물 선택 팝업(3×2)에 쓰는 샘플이다. 이 폴더에 아래 파일명 그대로 넣으면 된다.

```
woman_1.png  woman_2.png  woman_3.png
man_1.png    man_2.png    man_3.png
```

- 확장자는 `.png` 고정 (`src/routes/LookStudio.tsx` 의 `sampleSrc()` 참고).
- 세로 인물 사진 권장 (썸네일이 3:4 로 잘린다). 전신 ~ 무릎 위 정도가 Virtual Try-On 결과가 좋다.
- 전시물이므로 **초상권/모델 릴리스가 확보된 이미지**만 쓸 것.
- 코드에서 `/samples/woman_1.png` 같은 절대경로로 참조한다 (빌드 시 그대로 복사됨).
- 라벨(여성 1, 남성 2 …)을 바꾸려면 `LookStudio.tsx` 의 `SAMPLE_PEOPLE` 를 수정.
