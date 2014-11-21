function toggleDescription(elm){
  console.log("toggle", elm);
var e = $(elm+"_description");
  $(elm).toggleClass("open")


  e.slideToggle("fast", function(){
    console.log("done")
  })
}