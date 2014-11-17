function toggleDescription(elm){
  console.log("toggle", elm);
var e = $(elm+"_description");
  //$(elm+"_description").toggleClass("hide")

  console.log($(elm + "_description").css("height"));

  e.slideToggle("slow", function(){
    console.log("done")
  })
}