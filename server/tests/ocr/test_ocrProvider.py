def test_saveOcrMarkdown_writes_page_headers(tmp_path):
    from modules.ocr.ocrProvider import OCRService, OcrPage
    pages = [
        OcrPage(text="first page text", pageNumber=1),
        OcrPage(text="", pageNumber=2),
        OcrPage(text="third", pageNumber=3),
    ]
    outPath = str(tmp_path / "out.md")
    OCRService().saveOcrMarkdown(pages, outPath)
    with open(outPath, "r", encoding="utf-8") as f:
        content = f.read()
    assert "## Page 1" in content
    assert "first page text" in content
    assert "## Page 2" in content
    assert "## Page 3" in content
    assert "third" in content