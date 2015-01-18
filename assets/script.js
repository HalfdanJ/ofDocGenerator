function toggleDescription(elm){
  if($(elm).hasClass('method')) {

    var e = $(elm + "_description");
    $(elm).toggleClass("open")


    if ($(elm).hasClass("open")) {
      var wh = $(window).height();
      var eh = (e.height() + 80);
      if (eh > wh - 70) {
        eh = wh - 70;
      }

      var scrollBottom = $(elm).offset().top - wh + eh;
      if (scrollBottom > $(window).scrollTop()) {
        //Scroll
        $('html,body').animate({
          scrollTop: scrollBottom
        }, 300);
      }
    }

    e.slideToggle("fast", function () { });

  }
}


$( document ).ready(function() {
  var date = moment(info.date)
  $('.lastModified').text("Build: "+date.fromNow())

  // Check if there is a # in the url, and open the description if there is
  if(window.location.hash) {
    console.log(window.location.hash)
    toggleDescription(window.location.hash);
  }

  // Look for # change in the URL
  if ("onhashchange" in window) { // does the browser support the hashchange event?
    window.onhashchange = function () {
      if (!$(window.location.hash).hasClass("open")) {
        toggleDescription(window.location.hash);
      }

    }
  }

  $(".chapter").click(function () {
    $('.chapter.selected').removeClass('selected');

    $(this).addClass('selected');
  })


  var menu = $(".navigator");

  // All list items
  var offset = 150;
  var menuItems = menu.find("a");

  // Anchors corresponding to menu items
  var scrollItems = menuItems.map(function(){
    var item = $($(this).attr("href"));
    if (item.length) { return item; }
  });


  // Bind to scroll to update the menu
  $(window).scroll(function(){

    // Get container scroll position
    var fromTop = $(this).scrollTop() + offset;

    // Get id of current scroll item
    var cur = scrollItems.map(function(){
      if ($(this).offset().top < fromTop)
        return this;
    });

    if(cur.length == 0){
      cur = [scrollItems[0]]
    }
    // Get the id of the current element
    cur = cur[cur.length-1];
    var id = cur && cur.length ? cur[0].id : "";
    // Set/remove active class
    menuItems
      .parent().removeClass("selected")
      .end().filter("[href=#"+id+"]").parent().addClass("selected");

  });

});
