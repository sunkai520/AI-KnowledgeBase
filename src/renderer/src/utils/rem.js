(function () {
  var size = 100;
  var wd = 1300;
  function setSize() {
    var newWd = document.documentElement.clientWidth;
    var nwSize = size * (newWd / wd);
    // 超过基准宽度后不再放大，最多保持 100px（1200px 时的基准值）
    nwSize = Math.min(nwSize, size);
    document.documentElement.setAttribute("style", "font-size:" + nwSize + "px");
  }
  setSize();
  window.addEventListener("resize", function () {
    setSize();
  });
})();
